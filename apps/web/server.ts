import 'zone.js/node';
import express from 'express';

const app = express();
const port = Number(process.env.PORT || 4200);

app.use(express.static('dist/web/browser'));
app.get('*', (_req, res) => {
  res.sendFile('index.html', { root: 'dist/web/browser' });
});

app.listen(port, () => console.log(`Angular SSR host ready at http://localhost:${port}`));
