const STEPS = ['pipeline_search', 'pipeline_summarize', 'pipeline_save_to_file'];
const parse = output => output.structuredContent ?? JSON.parse(output.content?.find(item => item.type === 'text')?.text || '{}');
// Compact trace for the UI: large payloads are replaced by their checksum.
const describe = value => value && typeof value === 'object' && value.checksum ? { checksum: value.checksum, items: value.items?.length } : value;

// Each step's full output becomes the next step's input; the chain of checksums proves nothing was lost.
export async function runPipeline(mcp, { query, limit, format, name } = {}, now = () => Date.now()) {
  const plan = [
    { tool: STEPS[0], input: () => ({ ...(query ? { query } : {}), ...(limit ? { limit } : {}) }) },
    { tool: STEPS[1], input: ([search]) => ({ source: search }), check: ([search], report) => report.sourceChecksum === search.checksum },
    { tool: STEPS[2], input: ([, report]) => ({ report, ...(format ? { format } : {}), ...(name ? { name } : {}) }), check: ([, report], saved) => saved.reportChecksum === report.checksum },
  ];
  const outputs = [], steps = [];
  for (const step of plan) {
    if (steps.some(item => item.status === 'error')) { steps.push({ name: step.tool, status: 'skipped' }); continue; }
    const input = step.input(outputs);
    const started = now();
    let status = 'success', output;
    try {
      const response = await mcp.callTool(step.tool, input);
      output = parse(response);
      if (response.isError) status = 'error';
      else if (step.check && !step.check(outputs, output)) { status = 'error'; output = { error: 'Checksum входа и выхода шага не совпадает.' }; }
    } catch (error) { status = 'error'; output = { error: error.message || 'Не удалось вызвать инструмент.' }; }
    outputs.push(output);
    steps.push({ name: step.tool, status, durationMs: now() - started, input: Object.fromEntries(Object.entries(input).map(([key, value]) => [key, describe(value)])), output });
  }
  const ok = steps.every(step => step.status === 'success');
  return { status: ok ? 'success' : 'error', steps, report: ok ? outputs[1] : null, file: ok ? outputs[2] : null };
}
