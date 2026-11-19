import symbol from '../symbols/sidebar-expanded.js';
import { exportLottie as exportSymbol, lottieCapabilities as capabilities } from '../export/lottie.js';
export function exportLottie(request) { return exportSymbol(symbol, request); }
export function lottieCapabilities(options) { return capabilities(symbol, options); }
