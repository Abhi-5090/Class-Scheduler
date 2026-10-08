/*
 * The PDF exporters, loaded on first use. jsPDF and its table plugin are the
 * heaviest thing in the app and most visitors never export, so they are kept
 * out of the first download; each call fetches the module once, then reuses it.
 */
let mod;
const load = () => (mod ??= import('./pdfExport.js'));
const lazyExport = name => async (...args) => (await load())[name](...args);

export const exportBatchesPDF = lazyExport('exportBatchesPDF');
export const exportTrainerPDF = lazyExport('exportTrainerPDF');
export const exportAllTrainersPDF = lazyExport('exportAllTrainersPDF');
export const exportDayPDF = lazyExport('exportDayPDF');
export const exportMonthCalendarPDF = lazyExport('exportMonthCalendarPDF');
