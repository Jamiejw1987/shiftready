'use client';

/**
 * Turns each page of a PDF into a sharp JPEG in the browser (the server has no way to draw PDFs).
 * Used once, when an admin adds a client's document to an induction pack; temps then see these pictures.
 */
export async function pdfToImages(file: File, onProgress?: (done: number, total: number) => void): Promise<Blob[]> {
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  const out: Blob[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, 1500 / base.width);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.render({ canvasContext: ctx, viewport: vp, canvas } as any).promise;
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.84));
    if (!blob) throw new Error('Couldn’t draw page ' + n);
    out.push(blob);
    onProgress?.(n, pdf.numPages);
  }
  return out;
}
