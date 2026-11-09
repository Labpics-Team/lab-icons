/** Геометрия и допуск экспорта остаются у вызывающего владельца. */
export function downloadFile(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
