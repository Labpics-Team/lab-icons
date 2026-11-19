import symbol from '../symbols/move.js';
import { exportLottie as exportSymbol, lottieCapabilities as capabilities } from '../export/lottie.js';
export function exportLottie(request) { return exportSymbol(symbol, request); }
export function lottieCapabilities(options) { return capabilities(symbol, options); }
