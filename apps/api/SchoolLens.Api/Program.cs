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
var queueName = Environment.GetEnvironmentVariable("CRAWLER_QUEUE_NAME") ?? "schoollens:crawl";

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

static string NormalizeUrl(string url)
{
    var uri = new Uri(url);
    var builder = new UriBuilder(uri)
    {
        Query = string.Empty,
        Fragment = string.Empty,
        Path = uri.AbsolutePath.TrimEnd('/')
    };
    return builder.Uri.ToString().ToLowerInvariant();
}

static string HashUrl(string input)
{
    using var sha = SHA256.Create();
    var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(input));
    return Convert.ToHexString(bytes).ToLowerInvariant();
}

static (int Score, string Summary) ComputeScore(string text)
{
    var checks = new (string Keyword, int Points)[]
    {
        ("admission", 30),
        ("fees", 30),
        ("contact", 20),
        ("curriculum", 20)
    };

    var score = checks.Where(c => text.Contains(c.Keyword)).Sum(c => c.Points);
    var summary = score >= 70
        ? "Good baseline information found. Improve structure and parent-facing clarity."
        : "Important parent-facing content is missing. Add clear fees, admission, and contact sections.";

    return (score, summary);
}

app.MapPost("/api/scan", async (ScanRequest request, NpgsqlDataSource db, ConnectionMultiplexer redis) =>
{
    if (!Uri.TryCreate(request.Url, UriKind.Absolute, out _))
    {
        return Results.BadRequest(new { error = "Invalid URL" });
    }

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
                session = new
                {
                    id = reader.GetGuid(0),
                    status = reader.GetString(1),
                    overallScore = reader.IsDBNull(2) ? null : reader.GetInt32(2),
                    summary = reader.IsDBNull(3) ? null : reader.GetString(3)
                }
            });
        }
    }

    var sessionId = Guid.NewGuid();
    await using (var conn = await db.OpenConnectionAsync())
    {
        await using var cmd = new NpgsqlCommand("INSERT INTO analysis_sessions(id, url, url_hash, status) VALUES(@id,@url,@hash,'Queued')", conn);
        cmd.Parameters.AddWithValue("id", sessionId);
        cmd.Parameters.AddWithValue("url", normalizedUrl);
        cmd.Parameters.AddWithValue("hash", hash);
        await cmd.ExecuteNonQueryAsync();
    }

    var payload = JsonSerializer.Serialize(new CrawlJob(sessionId, normalizedUrl));
    await rdb.ListLeftPushAsync(queueName, payload);

    return Results.Accepted($"/api/scan/{sessionId}", new { cached = false, sessionId, status = "Queued" });
});

app.MapGet("/api/scan/{id:guid}", async (Guid id, NpgsqlDataSource db) =>
{
    await using var conn = await db.OpenConnectionAsync();
    await using var cmd = new NpgsqlCommand("SELECT id, url, status, overall_score, summary, created_at, completed_at FROM analysis_sessions WHERE id=@id", conn);
    cmd.Parameters.AddWithValue("id", id);

    await using var reader = await cmd.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return Results.NotFound(new { error = "Session not found" });
    }

    return Results.Ok(new
    {
        id = reader.GetGuid(0),
        url = reader.GetString(1),
        status = reader.GetString(2),
        overallScore = reader.IsDBNull(3) ? null : reader.GetInt32(3),
        summary = reader.IsDBNull(4) ? null : reader.GetString(4),
        createdAt = reader.GetDateTime(5),
        completedAt = reader.IsDBNull(6) ? null : reader.GetDateTime(6)
    });
});

app.MapPost("/api/scan/{id:guid}/ask", async (Guid id, AskRequest request, NpgsqlDataSource db, OpenAiService openAi) =>
{
    await using var conn = await db.OpenConnectionAsync();
    await using var getCmd = new NpgsqlCommand("SELECT page_url, extracted_text FROM crawled_pages WHERE session_id=@sid ORDER BY fetched_at DESC LIMIT 1", conn);
    getCmd.Parameters.AddWithValue("sid", id);

    await using var reader = await getCmd.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return Results.NotFound(new { error = "No crawled content yet. Please wait for scan completion." });
    }

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

app.MapPost("/internal/crawl-result", async (HttpRequest http, CrawlResult request, NpgsqlDataSource db, ConnectionMultiplexer redis, OpenAiService openAi) =>
{
    if (http.Headers["X-Internal-Key"] != internalApiKey)
    {
        return Results.Unauthorized();
    }

    await using var conn = await db.OpenConnectionAsync();
    await using var tx = await conn.BeginTransactionAsync();

    await using (var insertPage = new NpgsqlCommand("INSERT INTO crawled_pages(session_id, page_url, title, extracted_text) VALUES(@sid,@url,@title,@text)", conn, tx))
    {
        insertPage.Parameters.AddWithValue("sid", request.SessionId);
        insertPage.Parameters.AddWithValue("url", request.PageUrl);
        insertPage.Parameters.AddWithValue("title", request.Title ?? string.Empty);
        insertPage.Parameters.AddWithValue("text", request.ExtractedText ?? string.Empty);
        await insertPage.ExecuteNonQueryAsync();
    }

    var lowerText = (request.ExtractedText ?? string.Empty).ToLowerInvariant();
    var score = ComputeScore(lowerText);
    var summary = await openAi.TryGenerateSummaryAsync(request.PageUrl, request.ExtractedText ?? string.Empty, score.Score)
                  ?? score.Summary;

    await using (var updateSession = new NpgsqlCommand("UPDATE analysis_sessions SET status='Ready', overall_score=@score, summary=@summary, completed_at=NOW() WHERE id=@sid", conn, tx))
    {
        updateSession.Parameters.AddWithValue("sid", request.SessionId);
        updateSession.Parameters.AddWithValue("score", score.Score);
        updateSession.Parameters.AddWithValue("summary", summary);
        await updateSession.ExecuteNonQueryAsync();
    }

    await tx.CommitAsync();

    var cacheKey = $"analysis:v1:{HashUrl(NormalizeUrl(request.PageUrl))}";
    await redis.GetDatabase().StringSetAsync(cacheKey, request.SessionId.ToString(), TimeSpan.FromHours(24));

    return Results.Ok(new { ok = true });
});

app.MapGet("/api/health", async (NpgsqlDataSource db, ConnectionMultiplexer redis, OpenAiOptions options) =>
{
    await using var conn = await db.OpenConnectionAsync();
    await using var cmd = new NpgsqlCommand("SELECT 1", conn);
    await cmd.ExecuteScalarAsync();
    await redis.GetDatabase().PingAsync();
    return Results.Ok(new { ok = true, openAiConfigured = !string.IsNullOrWhiteSpace(options.ApiKey) });
});

app.Run();

record ScanRequest(string Url);
record AskRequest(string Question);
record CrawlJob(Guid SessionId, string Url);
record CrawlResult(Guid SessionId, string PageUrl, string? Title, string? ExtractedText);
record OpenAiOptions(string? ApiKey, string BaseUrl, string ChatModel, string ScoringModel);

sealed class OpenAiService(HttpClient httpClient, OpenAiOptions options, ILogger<OpenAiService> logger)
{
    public async Task<string?> TryGenerateSummaryAsync(string pageUrl, string extractedText, int score)
    {
        if (string.IsNullOrWhiteSpace(options.ApiKey))
        {
            return null;
        }

        var systemPrompt = "You summarize school website analysis in concise plain English. Return only one short paragraph.";
        var userPrompt = $"Page URL: {pageUrl}\nScore: {score}/100\nExtracted text:\n{extractedText[..Math.Min(6000, extractedText.Length)]}";
        return await TryChatCompletionAsync(options.ScoringModel, systemPrompt, userPrompt, 140);
    }

    public async Task<string?> TryAnswerQuestionAsync(string question, string extractedText, string pageUrl)
    {
        if (string.IsNullOrWhiteSpace(options.ApiKey))
        {
            return null;
        }

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
            {
                return null;
            }

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
