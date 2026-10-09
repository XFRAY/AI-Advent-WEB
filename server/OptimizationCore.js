export const PROFILES = {
  baseline: {
    id: 'baseline', label: 'До оптимизации', model: process.env.OLLAMA_BASELINE_MODEL || 'qwen3:1.7b-q8_0', quantization: 'Q8_0',
    systemPrompt: 'Ты универсальный русскоязычный помощник. Ответь на вопрос пользователя.',
    options: { temperature: 0.7, num_ctx: 4096, num_predict: 700 },
  },
  optimized: {
    id: 'optimized', label: 'После оптимизации', model: process.env.OLLAMA_OPTIMIZED_MODEL || 'qwen3:1.7b-q4_K_M', quantization: 'Q4_K_M',
    systemPrompt: `Ты опытный Kotlin/Android-инженер. Дай короткий практичный ответ на русском языке.
Если нужен код, используй компилируемый современный Kotlin и актуальные Android/Jetpack API.
Не выдумывай классы и методы. Явно назови важные допущения. Сначала решение, затем краткое объяснение.`,
    options: { temperature: 0.15, num_ctx: 2048, num_predict: 320 },
  },
};

export const BENCHMARK_TASKS = [
  { id: 'kotlin', category: 'Kotlin', title: 'Безопасная работа с null', prompt: 'Перепиши без !! и объясни кратко: fun display(user: User?) { println(user!!.name.uppercase()) }' },
  { id: 'coroutines', category: 'Coroutines', title: 'Параллельная загрузка', prompt: 'Покажи функцию suspend, которая параллельно загружает профиль и список заказов, а затем возвращает Dashboard. Ошибки не скрывай.' },
  { id: 'lifecycle', category: 'Lifecycle', title: 'Состояние ViewModel', prompt: 'Как безопасно собирать StateFlow из ViewModel во Fragment с учётом lifecycle? Дай минимальный Kotlin-код.' },
  { id: 'compose', category: 'Jetpack Compose', title: 'Лишние recomposition', prompt: 'Composable фильтрует большой список прямо в теле при каждой recomposition. Покажи исправление через remember и derivedStateOf.' },
];

export function publicProfile(profile) {
  return { id: profile.id, label: profile.label, model: profile.model, quantization: profile.quantization, options: profile.options };
}

function failure(profile, error) { return { status: 'error', profile: profile.id, model: profile.model, error: error.message }; }

export function createOptimizationRunner({ client, profiles = PROFILES } = {}) {
  async function runBatch(profile, prompts) {
    try {
      await client.warmup(profile);
      const outputs = [];
      for (const prompt of prompts) {
        const generated = await client.generate({ model: profile.model, messages: [{ role: 'system', content: profile.systemPrompt }, { role: 'user', content: prompt }], options: profile.options });
        outputs.push({ status: 'success', profile: profile.id, model: profile.model, answer: generated.content, metrics: generated.metrics });
      }
      const resources = await client.running(profile.model).catch(() => null);
      return outputs.map(output => ({ ...output, resources }));
    } catch (error) { return prompts.map(() => failure(profile, error)); }
    finally { await client.unload(profile.model).catch(() => {}); }
  }

  return {
    profiles,
    async compare(prompt) {
      const [baseline] = await runBatch(profiles.baseline, [prompt]);
      const [optimized] = await runBatch(profiles.optimized, [prompt]);
      return { baseline, optimized };
    },
    async benchmark(tasks = BENCHMARK_TASKS) {
      const prompts = tasks.map(task => task.prompt);
      const baseline = await runBatch(profiles.baseline, prompts);
      const optimized = await runBatch(profiles.optimized, prompts);
      return tasks.map((task, index) => ({ ...task, baseline: baseline[index], optimized: optimized[index] }));
    },
  };
}
