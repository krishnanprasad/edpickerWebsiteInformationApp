using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Npgsql;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

var pgHost = Environment.GetEnvironmentVariable("POSTGRES_HOST") ?? "localhost";
var pgPort = Environment.GetEnvironmentVariable("POSTGRES_PORT") ?? "5432";
var pgDb = Environment.GetEnvironmentVariable("POSTGRES_DB") ?? "edpicker-crawler-app";
var pgUser = Environment.GetEnvironmentVariable("POSTGRES_USER") ?? "dev";
var pgPassword = Environment.GetEnvironmentVariable("POSTGRES_PASSWORD") ?? "dev";
var pgSslMode = Environment.GetEnvironmentVariable("POSTGRES_SSLMODE") ?? "disable";
var redisUrl = Environment.GetEnvironmentVariable("REDIS_URL") ?? "redis://localhost:6379";
var internalApiKey = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? "change-me";
var crawlQueueName = Environment.GetEnvironmentVariable("CRAWLER_QUEUE_NAME") ?? "schoollens-crawl";
var classifyQueueName = Environment.GetEnvironmentVariable("CLASSIFY_QUEUE_NAME") ?? "schoollens-classify";

var openAiOptions = new OpenAiOptions(
    ApiKey: Environment.GetEnvironmentVariable("OPENAI_API_KEY"),
    BaseUrl: Environment.GetEnvironmentVariable("OPENAI_BASE_URL") ?? "https://api.openai.com/v1",
    ChatModel: Environment.GetEnvironmentVariable("OPENAI_MODEL_CHAT") ?? "gpt-4o",
    ScoringModel: Environment.GetEnvironmentVariable("OPENAI_MODEL_SCORING") ?? "gpt-4o-mini");

var pgConnectionString = $"Host={pgHost};Port={pgPort};Database={pgDb};Username={pgUser};Password={pgPassword};Ssl Mode={pgSslMode}";

builder.Services.AddSingleton(new NpgsqlDataSourceBuilder(pgConnectionString).Build());
builder.Services.AddSingleton(ConnectionMultiplexer.Connect(redisUrl));
builder.Services.AddSingleton(openAiOptions);
builder.Services.AddHttpClient<OpenAiService>();

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();

// ================================================================
// Helpers
// ================================================================
static string NormalizeUrl(string url)
{
    var uri = new Uri(url);
    var b = new UriBuilder(uri)
    {
        Query = string.Empty,
        Fragment = string.Empty,
        Path = uri.AbsolutePath.TrimEnd('/')
    };
    return b.Uri.ToString().ToLowerInvariant();
}

static string HashUrl(string input)
{
    using var sha = SHA256.Create();
    var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(input));
    return Convert.ToHexString(bytes).ToLowerInvariant();
}

// ================================================================
// POST /api/scan — now enqueues classification first
// ================================================================
app.MapPost("/api/scan", async (ScanRequest request, NpgsqlDataSource db, ConnectionMultiplexer redis) =>
{
    if (!Uri.TryCreate(request.Url, UriKind.Absolute, out _))
        return Results.BadRequest(new { error = "Invalid URL" });

    var normalizedUrl = NormalizeUrl(request.Url);
    var hash = HashUrl(normalizedUrl);
    var cacheKey = $"analysis:v1:{hash}";
    var rdb = redis.GetDatabase();

    var cachedSessionId = await rdb.StringGetAsync(cacheKey);
    if (cachedSessionId.HasValue)
    {
        await using var conn = await db.OpenConnectionAsync();
        await using var cmd = new NpgsqlCommand("SELECT id, status, overall_score, summary, completed_at FROM analysis_sessions WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("id", Guid.Parse(cachedSessionId!));
        await using var reader = await cmd.ExecuteReaderAsync();
        if (await reader.ReadAsync())
        {
            return Results.Ok(new
            {
                cached = true,
                sessionId = reader.GetGuid(0),
                session = new
                {
                    id = reader.GetGuid(0),
                    status = reader.GetString(1),
                    overallScore = reader.IsDBNull(2) ? (int?)null : reader.GetInt32(2),
                    summary = reader.IsDBNull(3) ? null : reader.GetString(3)
                }
            });
        }
    }

    var sessionId = Guid.NewGuid();
    await using (var conn = await db.OpenConnectionAsync())
    {
        await using var cmd = new NpgsqlCommand("INSERT INTO analysis_sessions(id, url, url_hash, status) VALUES(@id,@url,@hash,'Classifying')", conn);
        cmd.Parameters.AddWithValue("id", sessionId);
        cmd.Parameters.AddWithValue("url", normalizedUrl);
        cmd.Parameters.AddWithValue("hash", hash);
        await cmd.ExecuteNonQueryAsync();
    }

    // Enqueue classification job
    var payload = JsonSerializer.Serialize(new ClassifyJob(sessionId, normalizedUrl, 30));
    await rdb.ListLeftPushAsync(classifyQueueName, payload);

    return Results.Accepted($"/api/scan/{sessionId}", new { cached = false, sessionId, status = "Classifying" });
});

// ================================================================
// GET /api/scan/{id} — enriched response
// ================================================================
app.MapGet("/api/scan/{id:guid}", async (Guid id, NpgsqlDataSource db) =>
{
    await using var conn = await db.OpenConnectionAsync();
    await using var sessionCmd = new NpgsqlCommand(
        @"SELECT id, url, status, overall_score, summary,
                 pages_scanned, pdfs_scanned, images_scanned,
                 max_depth_reached, structured_data_detected,
                 scan_duration_ms, scan_confidence, scan_confidence_label,
                 created_at, completed_at
          FROM analysis_sessions WHERE id=@id", conn);
    sessionCmd.Parameters.AddWithValue("id", id);

    await using var reader = await sessionCmd.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
        return Results.NotFound(new { error = "Session not found" });

    var status = reader.GetString(2);
    var response = new Dictionary<string, object?>
    {
        ["sessionId"] = reader.GetGuid(0),
        ["url"] = reader.GetString(1),
        ["status"] = status,
        ["createdAt"] = reader.GetDateTime(13)
    };
    var overallScore = reader.IsDBNull(3) ? (int?)null : reader.GetInt32(3);
    var summary = reader.IsDBNull(4) ? null : reader.GetString(4);
    var pagesScanned = reader.IsDBNull(5) ? 0 : reader.GetInt32(5);
    var pdfsScanned = reader.IsDBNull(6) ? 0 : reader.GetInt32(6);
    var imagesScanned = reader.IsDBNull(7) ? 0 : reader.GetInt32(7);
    var maxDepth = reader.IsDBNull(8) ? 0 : reader.GetInt32(8);
    var structuredData = !reader.IsDBNull(9) && reader.GetBoolean(9);
    var scanDurationMs = reader.IsDBNull(10) ? (int?)null : reader.GetInt32(10);
    var scanConfidence = reader.IsDBNull(11) ? (int?)null : reader.GetInt32(11);
    var scanConfidenceLabel = reader.IsDBNull(12) ? null : reader.GetString(12);
    var completedAt = reader.IsDBNull(14) ? (DateTime?)null : reader.GetDateTime(14);
    await reader.CloseAsync();

    // Classification
    await using var classCmd = new NpgsqlCommand("SELECT is_educational, confidence, matched_keywords FROM education_classification WHERE session_id=@sid", conn);
    classCmd.Parameters.AddWithValue("sid", id);
    await using var classReader = await classCmd.ExecuteReaderAsync();
    if (await classReader.ReadAsync())
    {
        response["classification"] = new
        {
            isEducational = classReader.GetBoolean(0),
            confidence = classReader.GetDouble(1),
            matchedKeywords = classReader.IsDBNull(2) ? null : JsonSerializer.Deserialize<object>(classReader.GetString(2))
        };
    }
    await classReader.CloseAsync();

    if (status == "Rejected")
    {
        response["message"] = "This website does not appear to be an educational institution. SchoolLens currently supports school and educational website analysis only.";
        return Results.Ok(response);
    }

    // Crawl summary
    if (pagesScanned > 0 || status is "Scoring" or "Ready")
    {
        response["crawlSummary"] = new
        {
            pagesScanned,
            pdfsScanned,
            imagesScanned,
            depthReached = maxDepth,
            structuredDataDetected = structuredData,
            scanTimeSeconds = scanDurationMs.HasValue ? (int?)Math.Round(scanDurationMs.Value / 1000.0) : null,
            scanConfidence,
            scanConfidenceLabel
        };
    }

    if (status == "Ready")
    {
        response["overallScore"] = overallScore;
        response["summary"] = summary;
        response["completedAt"] = completedAt;

        // Safety
        await using var safetyCmd = new NpgsqlCommand(
            @"SELECT total_score, badge_level,
                     fire_certificate, sanitary_certificate, cctv_mention,
                     transport_safety, anti_bullying_policy, raw_evidence
              FROM safety_scores WHERE session_id=@sid", conn);
        safetyCmd.Parameters.AddWithValue("sid", id);
        await using var sReader = await safetyCmd.ExecuteReaderAsync();
        if (await sReader.ReadAsync())
        {
            var rawEvidence = sReader.IsDBNull(7) ? new Dictionary<string, string?>() :
                JsonSerializer.Deserialize<Dictionary<string, string?>>(sReader.GetString(7))
                ?? new Dictionary<string, string?>();

            response["safetyScore"] = new
            {
                total = sReader.GetInt32(0),
                badge = sReader.GetString(1),
                items = new
                {
                    fireCertificate = new { status = sReader.GetString(2), evidence = rawEvidence.GetValueOrDefault("fire_evidence") },
                    sanitaryCertificate = new { status = sReader.GetString(3), evidence = rawEvidence.GetValueOrDefault("sanitary_evidence") },
                    cctvMention = new { status = sReader.GetString(4), evidence = rawEvidence.GetValueOrDefault("cctv_evidence") },
                    transportSafety = new { status = sReader.GetString(5), evidence = rawEvidence.GetValueOrDefault("transport_evidence") },
                    antiBullyingPolicy = new { status = sReader.GetString(6), evidence = rawEvidence.GetValueOrDefault("anti_bullying_evidence") }
                }
            };
        }
        await sReader.CloseAsync();

        // Clarity
        await using var clarityCmd = new NpgsqlCommand(
            @"SELECT total_score, clarity_label,
                     admission_dates_visible, fee_clarity, academic_calendar,
                     contact_and_map, results_published
              FROM clarity_scores WHERE session_id=@sid", conn);
        clarityCmd.Parameters.AddWithValue("sid", id);
        await using var cReader = await clarityCmd.ExecuteReaderAsync();
        if (await cReader.ReadAsync())
        {
            var cTotal = cReader.GetInt32(0);
            response["clarityScore"] = new
            {
                total = cTotal,
                label = cReader.IsDBNull(1) ? null : cReader.GetString(1),
                note = cTotal < 60 ? "Parents may need to call the school for missing information." : (string?)null,
                items = new
                {
                    admissionDatesVisible = cReader.GetBoolean(2),
                    feeClarity = cReader.GetBoolean(3),
                    academicCalendar = cReader.GetBoolean(4),
                    contactAndMap = cReader.GetBoolean(5),
                    resultsPublished = cReader.GetBoolean(6)
                }
            };
        }
        await cReader.CloseAsync();
    }

    return Results.Ok(response);
});

// ================================================================
// POST /api/scan/{id}/ask — Q&A
// ================================================================
app.MapPost("/api/scan/{id:guid}/ask", async (Guid id, AskRequest request, NpgsqlDataSource db, OpenAiService openAi) =>
{
    await using var conn = await db.OpenConnectionAsync();
    await using var getCmd = new NpgsqlCommand("SELECT page_url, extracted_text FROM crawled_pages WHERE session_id=@sid ORDER BY fetched_at DESC LIMIT 1", conn);
    getCmd.Parameters.AddWithValue("sid", id);

    await using var reader = await getCmd.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
        return Results.NotFound(new { error = "No crawled content yet. Please wait for scan completion." });

    var pageUrl = reader.GetString(0);
    var text = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
    await reader.CloseAsync();

    var words = request.Question.ToLowerInvariant()
        .Split(new[] { ' ', ',', '.', '?', '!' }, StringSplitOptions.RemoveEmptyEntries)
        .Where(w => w.Length > 3)
        .ToArray();

    var sentence = text.Split('.').FirstOrDefault(s => words.Any(w => s.Contains(w, StringComparison.OrdinalIgnoreCase)));
    var fallbackAnswer = string.IsNullOrWhiteSpace(sentence)
        ? "This information was not found on your website. Recommended addition: add a clear section for this question."
        : $"Based on your website: {sentence.Trim()}.";

    var answer = await openAi.TryAnswerQuestionAsync(request.Question, text, pageUrl) ?? fallbackAnswer;

    var excerpt = string.IsNullOrWhiteSpace(sentence)
        ? text[..Math.Min(220, text.Length)]
        : sentence.Trim();

    var citations = JsonSerializer.Serialize(new[] { new { pageUrl, excerpt } });

    await using var saveCmd = new NpgsqlCommand(@"
        INSERT INTO chat_messages(session_id, role, content, citations) VALUES(@sid, 'user', @q, '[]'::jsonb);
        INSERT INTO chat_messages(session_id, role, content, citations) VALUES(@sid, 'assistant', @a, @c::jsonb);", conn);
    saveCmd.Parameters.AddWithValue("sid", id);
    saveCmd.Parameters.AddWithValue("q", request.Question);
    saveCmd.Parameters.AddWithValue("a", answer);
    saveCmd.Parameters.AddWithValue("c", citations);
    await saveCmd.ExecuteNonQueryAsync();

    return Results.Ok(new { answer, citations = JsonSerializer.Deserialize<object>(citations) });
});

// ================================================================
// POST /internal/classify-result — classification callback
// ================================================================
app.MapPost("/internal/classify-result", async (HttpRequest http, ClassifyResult request, NpgsqlDataSource db, ConnectionMultiplexer redis) =>
{
    if (http.Headers["X-Internal-Key"] != internalApiKey)
        return Results.Unauthorized();

    await using var conn = await db.OpenConnectionAsync();

    // Save classification
    await using (var cmd = new NpgsqlCommand(
        @"INSERT INTO education_classification(session_id, is_educational, confidence, matched_keywords)
          VALUES(@sid, @edu, @conf, @kw::jsonb)
          ON CONFLICT(session_id) DO UPDATE SET is_educational=@edu, confidence=@conf, matched_keywords=@kw::jsonb", conn))
    {
        cmd.Parameters.AddWithValue("sid", request.SessionId);
        cmd.Parameters.AddWithValue("edu", request.IsEducational);
        cmd.Parameters.AddWithValue("conf", request.Confidence);
        cmd.Parameters.AddWithValue("kw", JsonSerializer.Serialize(request.MatchedKeywords));
        await cmd.ExecuteNonQueryAsync();
    }

    if (request.IsEducational)
    {
        await using var upd = new NpgsqlCommand("UPDATE analysis_sessions SET status='Crawling' WHERE id=@sid", conn);
        upd.Parameters.AddWithValue("sid", request.SessionId);
        await upd.ExecuteNonQueryAsync();

        var payload = JsonSerializer.Serialize(new CrawlJob(request.SessionId, request.Url));
        await redis.GetDatabase().ListLeftPushAsync(crawlQueueName, payload);
    }
    else
    {
        await using var upd = new NpgsqlCommand("UPDATE analysis_sessions SET status='Rejected', completed_at=NOW() WHERE id=@sid", conn);
        upd.Parameters.AddWithValue("sid", request.SessionId);
        await upd.ExecuteNonQueryAsync();
    }

    return Results.Ok(new { ok = true });
});

// ================================================================
// POST /internal/crawl-result — saves crawled data + stats
// ================================================================
app.MapPost("/internal/crawl-result", async (HttpRequest http, CrawlResultPayload request, NpgsqlDataSource db, ConnectionMultiplexer redis) =>
{
    if (http.Headers["X-Internal-Key"] != internalApiKey)
        return Results.Unauthorized();

    await using var conn = await db.OpenConnectionAsync();
    await using var tx = await conn.BeginTransactionAsync();

    // Save page
    await using (var insertPage = new NpgsqlCommand("INSERT INTO crawled_pages(session_id, page_url, title, extracted_text) VALUES(@sid,@url,@title,@text)", conn, tx))
    {
        insertPage.Parameters.AddWithValue("sid", request.SessionId);
        insertPage.Parameters.AddWithValue("url", request.PageUrl);
        insertPage.Parameters.AddWithValue("title", request.Title ?? string.Empty);
        insertPage.Parameters.AddWithValue("text", request.ExtractedText ?? string.Empty);
        await insertPage.ExecuteNonQueryAsync();
    }

    // Update crawl stats
    await using (var upd = new NpgsqlCommand(
        @"UPDATE analysis_sessions SET status='Scoring',
          pages_scanned=@ps, pdfs_scanned=@pds, images_scanned=@ims,
          max_depth_reached=@md, structured_data_detected=@sd,
          scan_duration_ms=@dur, scan_confidence=@sc, scan_confidence_label=@scl
          WHERE id=@sid", conn, tx))
    {
        upd.Parameters.AddWithValue("sid", request.SessionId);
        upd.Parameters.AddWithValue("ps", request.PagesScanned);
        upd.Parameters.AddWithValue("pds", request.PdfsScanned);
        upd.Parameters.AddWithValue("ims", request.ImagesScanned);
        upd.Parameters.AddWithValue("md", request.MaxDepthReached);
        upd.Parameters.AddWithValue("sd", request.StructuredDataDetected);
        upd.Parameters.AddWithValue("dur", request.ScanDurationMs);
        upd.Parameters.AddWithValue("sc", request.ScanConfidence);
        upd.Parameters.AddWithValue("scl", request.ScanConfidenceLabel);
        await upd.ExecuteNonQueryAsync();
    }

    await tx.CommitAsync();
    return Results.Ok(new { ok = true });
});

// ================================================================
// POST /internal/score-complete — saves safety + clarity scores
// ================================================================
app.MapPost("/internal/score-complete", async (HttpRequest http, ScoreCompletePayload request, NpgsqlDataSource db, ConnectionMultiplexer redis) =>
{
    if (http.Headers["X-Internal-Key"] != internalApiKey)
        return Results.Unauthorized();

    await using var conn = await db.OpenConnectionAsync();
    await using var tx = await conn.BeginTransactionAsync();

    // Update session
    await using (var upd = new NpgsqlCommand("UPDATE analysis_sessions SET status='Ready', overall_score=@score, summary=@summary, completed_at=NOW() WHERE id=@sid", conn, tx))
    {
        upd.Parameters.AddWithValue("sid", request.SessionId);
        upd.Parameters.AddWithValue("score", request.OverallScore);
        upd.Parameters.AddWithValue("summary", request.Summary);
        await upd.ExecuteNonQueryAsync();
    }

    // Upsert safety
    var rawEvidence = JsonSerializer.Serialize(new
    {
        fire_evidence = request.SafetyScore.FireEvidence,
        sanitary_evidence = request.SafetyScore.SanitaryEvidence,
        cctv_evidence = request.SafetyScore.CctvEvidence,
        transport_evidence = request.SafetyScore.TransportEvidence,
        anti_bullying_evidence = request.SafetyScore.AntiBullyingEvidence
    });

    await using (var ins = new NpgsqlCommand(
        @"INSERT INTO safety_scores(session_id, total_score, fire_certificate, sanitary_certificate, cctv_mention, transport_safety, anti_bullying_policy, badge_level, raw_evidence)
          VALUES(@sid, @total, @fire, @san, @cctv, @trans, @bully, @badge, @ev::jsonb)
          ON CONFLICT(session_id) DO UPDATE SET total_score=@total, fire_certificate=@fire, sanitary_certificate=@san,
          cctv_mention=@cctv, transport_safety=@trans, anti_bullying_policy=@bully, badge_level=@badge, raw_evidence=@ev::jsonb", conn, tx))
    {
        ins.Parameters.AddWithValue("sid", request.SessionId);
        ins.Parameters.AddWithValue("total", request.SafetyScore.Total);
        ins.Parameters.AddWithValue("fire", request.SafetyScore.FireCertificate);
        ins.Parameters.AddWithValue("san", request.SafetyScore.SanitaryCertificate);
        ins.Parameters.AddWithValue("cctv", request.SafetyScore.CctvMention);
        ins.Parameters.AddWithValue("trans", request.SafetyScore.TransportSafety);
        ins.Parameters.AddWithValue("bully", request.SafetyScore.AntiBullyingPolicy);
        ins.Parameters.AddWithValue("badge", request.SafetyScore.Badge);
        ins.Parameters.AddWithValue("ev", rawEvidence);
        await ins.ExecuteNonQueryAsync();
    }

    // Upsert clarity
    await using (var ins = new NpgsqlCommand(
        @"INSERT INTO clarity_scores(session_id, total_score, admission_dates_visible, fee_clarity, academic_calendar, contact_and_map, results_published, clarity_label)
          VALUES(@sid, @total, @adm, @fee, @cal, @con, @res, @label)
          ON CONFLICT(session_id) DO UPDATE SET total_score=@total, admission_dates_visible=@adm, fee_clarity=@fee,
          academic_calendar=@cal, contact_and_map=@con, results_published=@res, clarity_label=@label", conn, tx))
    {
        ins.Parameters.AddWithValue("sid", request.SessionId);
        ins.Parameters.AddWithValue("total", request.ClarityScore.Total);
        ins.Parameters.AddWithValue("adm", request.ClarityScore.AdmissionDatesVisible);
        ins.Parameters.AddWithValue("fee", request.ClarityScore.FeeClarity);
        ins.Parameters.AddWithValue("cal", request.ClarityScore.AcademicCalendar);
        ins.Parameters.AddWithValue("con", request.ClarityScore.ContactAndMap);
        ins.Parameters.AddWithValue("res", request.ClarityScore.ResultsPublished);
        ins.Parameters.AddWithValue("label", request.ClarityScore.Label);
        await ins.ExecuteNonQueryAsync();
    }

    await tx.CommitAsync();

    // Cache
    var cacheKey = $"analysis:v1:{request.UrlHash}";
    await redis.GetDatabase().StringSetAsync(cacheKey, request.SessionId.ToString(), TimeSpan.FromHours(24));

    return Results.Ok(new { ok = true });
});

// ================================================================
// POST /api/b2b-interest — B2B CTA tracking
// ================================================================
app.MapPost("/api/b2b-interest", async (B2bInterestRequest request, NpgsqlDataSource db) =>
{
    await using var conn = await db.OpenConnectionAsync();

    await using var check = new NpgsqlCommand("SELECT url FROM analysis_sessions WHERE id=@sid", conn);
    check.Parameters.AddWithValue("sid", request.SessionId);
    var url = await check.ExecuteScalarAsync() as string;
    if (url == null)
        return Results.NotFound(new { error = "Session not found" });

    await using var ins = new NpgsqlCommand("INSERT INTO b2b_leads(session_id, url) VALUES(@sid, @url)", conn);
    ins.Parameters.AddWithValue("sid", request.SessionId);
    ins.Parameters.AddWithValue("url", url);
    await ins.ExecuteNonQueryAsync();

    var ctaUrl = Environment.GetEnvironmentVariable("B2B_CTA_URL") ?? "mailto:contact@edpicker.com";
    return Results.Ok(new { ok = true, ctaUrl });
});

// ================================================================
// Health
// ================================================================
app.MapGet("/api/health", async (NpgsqlDataSource db, ConnectionMultiplexer redis, OpenAiOptions options) =>
{
    await using var conn = await db.OpenConnectionAsync();
    await using var cmd = new NpgsqlCommand("SELECT 1", conn);
    await cmd.ExecuteScalarAsync();
    await redis.GetDatabase().PingAsync();
    return Results.Ok(new
    {
        ok = true,
        openAiConfigured = !string.IsNullOrWhiteSpace(options.ApiKey),
        queue = new { classify = classifyQueueName, crawl = crawlQueueName }
    });
});

app.Run();

// ================================================================
// Records
// ================================================================
record ScanRequest(string Url);
record AskRequest(string Question);
record ClassifyJob(Guid SessionId, string Url, int MaxPages);
record CrawlJob(Guid SessionId, string Url);
record B2bInterestRequest(Guid SessionId);

record ClassifyResult(
    Guid SessionId, string Url, int MaxPages,
    bool IsEducational, double Confidence, string[] MatchedKeywords);

record CrawlResultPayload(
    Guid SessionId, string PageUrl, string? Title, string? ExtractedText,
    int PagesScanned, int PdfsScanned, int ImagesScanned,
    int MaxDepthReached, bool StructuredDataDetected,
    int ScanDurationMs, int ScanConfidence, string ScanConfidenceLabel);

record SafetyScorePayload(
    int Total, string Badge,
    string FireCertificate, string? FireEvidence,
    string SanitaryCertificate, string? SanitaryEvidence,
    string CctvMention, string? CctvEvidence,
    string TransportSafety, string? TransportEvidence,
    string AntiBullyingPolicy, string? AntiBullyingEvidence);

record ClarityScorePayload(
    int Total, string Label,
    bool AdmissionDatesVisible, bool FeeClarity,
    bool AcademicCalendar, bool ContactAndMap, bool ResultsPublished);

record ScoreCompletePayload(
    Guid SessionId, int OverallScore, string Summary, string UrlHash,
    SafetyScorePayload SafetyScore, ClarityScorePayload ClarityScore);

record OpenAiOptions(string? ApiKey, string BaseUrl, string ChatModel, string ScoringModel);

sealed class OpenAiService(HttpClient httpClient, OpenAiOptions options, ILogger<OpenAiService> logger)
{
    public async Task<string?> TryGenerateSummaryAsync(string pageUrl, string extractedText, int score)
    {
        if (string.IsNullOrWhiteSpace(options.ApiKey))
            return null;

        var systemPrompt = "You summarize school website analysis in concise plain English. Return only one short paragraph.";
        var userPrompt = $"Page URL: {pageUrl}\nScore: {score}/100\nExtracted text:\n{extractedText[..Math.Min(6000, extractedText.Length)]}";
        return await TryChatCompletionAsync(options.ScoringModel, systemPrompt, userPrompt, 140);
    }

    public async Task<string?> TryAnswerQuestionAsync(string question, string extractedText, string pageUrl)
    {
        if (string.IsNullOrWhiteSpace(options.ApiKey))
            return null;

        var systemPrompt = "Answer only from provided page text. If not found, say it is not found and suggest a specific addition.";
        var userPrompt = $"Question: {question}\nSource URL: {pageUrl}\nPage text:\n{extractedText[..Math.Min(9000, extractedText.Length)]}";
        return await TryChatCompletionAsync(options.ChatModel, systemPrompt, userPrompt, 240);
    }

    private async Task<string?> TryChatCompletionAsync(string model, string systemPrompt, string userPrompt, int maxTokens)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{options.BaseUrl.TrimEnd('/')}/chat/completions");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.ApiKey);
            request.Content = new StringContent(JsonSerializer.Serialize(new
            {
                model,
                temperature = 0.0,
                max_tokens = maxTokens,
                messages = new object[]
                {
                    new { role = "system", content = systemPrompt },
                    new { role = "user", content = userPrompt }
                }
            }), Encoding.UTF8, "application/json");

            using var response = await httpClient.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("OpenAI call failed with status code {StatusCode}", response.StatusCode);
                return null;
            }

            using var stream = await response.Content.ReadAsStreamAsync();
            using var doc = await JsonDocument.ParseAsync(stream);
            var root = doc.RootElement;
            if (!root.TryGetProperty("choices", out var choices) || choices.GetArrayLength() == 0)
                return null;

            var content = choices[0].GetProperty("message").GetProperty("content").GetString();
            return string.IsNullOrWhiteSpace(content) ? null : content.Trim();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "OpenAI call threw exception. Falling back to deterministic behavior.");
            return null;
        }
    }
}
