import { defaultReportsDir, listReports, readReport, saveReport } from './files.js';
import { filesTools } from './tools.js';
import { createToolServer, isMain, serveStdio } from '../shared.js';

export const createFilesServer = ({ dir = defaultReportsDir() } = {}) => createToolServer({
  name: 'files', definitions: filesTools,
  handlers: {
    files_save_report: args => saveReport({ dir, ...args }),
    files_list_reports: () => listReports({ dir }),
    files_read_report: ({ file }) => readReport({ dir, file }),
  },
});
if (isMain(import.meta)) await serveStdio(createFilesServer());
