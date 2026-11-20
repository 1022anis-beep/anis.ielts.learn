import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'complete-ielts-b1-studio' });
});

app.post('/api/evaluate-writing', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error:
        'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets to enable AI writing evaluation, or use the Interactive Self-Check Rubric.',
    });
    return;
  }

  const { taskType, promptText, essayText, unitNumber } = req.body ?? {};
  if (
    (taskType !== 'task1' && taskType !== 'task2') ||
    typeof essayText !== 'string' ||
    essayText.trim().length < 20
  ) {
    res.status(400).json({
      error: 'Please write at least a few sentences before requesting an AI rubric evaluation.',
    });
    return;
  }

  const wordCount = essayText.trim().split(/\s+/).filter(Boolean).length;
  const minWords = taskType === 'task1' ? 150 : 250;

  const taskCriteriaDescription =
    taskType === 'task1'
      ? `1. Task Achievement (25%): paraphrased introduction, clear overview without detail numbers, accurate data comparisons, >= 150 words.
2. Coherence & Cohesion (25%): logical 4-paragraph structure, sequencers and comparative linkers.
3. Lexical Resource (25%): trend vocabulary (rise, fall, peak, remain stable), accurate use of percent vs percentage and number vs amount.
4. Grammatical Range & Accuracy (25%): tense consistency, accurate data and time prepositions (by, to, from, between).`
      : `1. Task Response (25%): all parts of the prompt answered, consistent position throughout, relevant supporting examples, >= 250 words.
2. Coherence & Cohesion (25%): clear topic sentences per paragraph, accurate linkers (also, and, but, however, although).
3. Lexical Resource (25%): unit topic collocations, accurate word formation, double-letter spelling control.
4. Grammatical Range & Accuracy (25%): conditionals, relative clauses, articles, countable/uncountable noun control.`;

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Evaluate this Complete IELTS Bands 4-5 (CEFR B1) ${taskType === 'task1' ? 'Academic Writing Task 1' : 'Writing Task 2'} response from Unit ${unitNumber ?? 1}.

Task Prompt:
${typeof promptText === 'string' ? promptText : 'IELTS Writing Task'}

Student Response (${wordCount} words; target minimum ${minWords} words):
${essayText}

Evaluate strictly against these 4 equally weighted (25% each) IELTS criteria:
${taskCriteriaDescription}

Provide constructive, B1-accessible feedback, band scores (between 3.5 and 6.5 in 0.5 steps), and up to 4 specific grammar/spelling corrections tied to Complete IELTS Language Reference points.`,
      config: {
        systemInstruction:
          'You are an encouraging, accurate IELTS Bands 4-5 (CEFR B1) examiner. Return valid JSON matching the schema.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallBand: { type: Type.NUMBER, description: 'Overall IELTS writing band in 0.5 increments (3.5 to 6.5).' },
            wordCount: { type: Type.INTEGER },
            criteria: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  band: { type: Type.NUMBER },
                  weightPercent: { type: Type.INTEGER },
                  strengths: { type: Type.STRING },
                  improvements: { type: Type.STRING },
                },
                required: ['name', 'band', 'weightPercent', 'strengths', 'improvements'],
              },
            },
            summaryFeedback: { type: Type.STRING },
            grammarHighlights: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  original: { type: Type.STRING },
                  suggestion: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                },
                required: ['original', 'suggestion', 'explanation'],
              },
            },
          },
          required: ['overallBand', 'wordCount', 'criteria', 'summaryFeedback', 'grammarHighlights'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json(parsed);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to evaluate writing with Gemini API.';
    console.error('Gemini writing evaluation error:', err);
    res.status(502).json({ error: message });
  }
});

async function startServer() {
  const port = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Complete IELTS B1 Studio server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
