// Pulso en vivo por Bluetooth: el Fitbit Air, con "Compartir frecuencia cardiaca" activo en la app Google Health,
// transmite con el perfil estándar de ritmo cardiaco (servicio 0x180D, característica 0x2A37). Si además manda los
// intervalos entre latidos (RR), de ahí salen la VFC (RMSSD) y una estimación de la frecuencia respiratoria.
(function (root) {
  // Heart Rate Measurement (0x2A37): flags, FC en uint8 o uint16, energía opcional, RR en 1/1024 s
  function leerMedicion(dv) {
    const flags = dv.getUint8(0);
    let i = 1;
    const lpm = flags & 0x01 ? dv.getUint16(i, true) : dv.getUint8(i);
    i += flags & 0x01 ? 2 : 1;
    const contacto = (flags & 0x06) === 0x06 ? true : (flags & 0x06) === 0x04 ? false : null;
    if (flags & 0x08) i += 2; // energía gastada
    const rr = [];
    if (flags & 0x10) for (; i + 1 < dv.byteLength; i += 2) rr.push(Math.round((dv.getUint16(i, true) / 1024) * 1000));
    return { lpm, rr, contacto };
  }

  const media = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
  const mediana = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // Quita latidos imposibles (fuera de 300-2000 ms) y saltos de más de 25% respecto a la mediana local
  function limpiarRr(rr) {
    const fis = rr.filter((x) => x >= 300 && x <= 2000);
    return fis.filter((x, i) => { const loc = mediana(fis.slice(Math.max(0, i - 5), i + 6)); return Math.abs(x - loc) / loc <= 0.25; });
  }

  function rmssd(rr) {
    const xs = limpiarRr(rr);
    if (xs.length < 10) return null;
    const d = [];
    for (let i = 1; i < xs.length; i++) d.push(xs[i] - xs[i - 1]);
    return Math.round(Math.sqrt(media(d.map((x) => x * x))));
  }

  // FR por arritmia sinusal respiratoria: el ritmo se acelera al inhalar y se frena al exhalar.
  // Tacograma remuestreado a 4 Hz y pico espectral entre 0.1 y 0.5 Hz (6-30 rpm). Necesita ~40 s de RR.
  function frDesdeRr(rr) {
    const xs = limpiarRr(rr);
    if (xs.length < 30) return null;
    let t = 0;
    const ts = xs.map((x) => (t += x));
    if (ts[ts.length - 1] < 40000) return null;
    const fs = 4, serie = [];
    let j = 0;
    for (let s = ts[0]; s <= ts[ts.length - 1]; s += 1000 / fs) {
      while (j < ts.length - 2 && ts[j + 1] < s) j++;
      const f = Math.min(1, Math.max(0, (s - ts[j]) / (ts[j + 1] - ts[j])));
      serie.push(xs[j] + (xs[j + 1] - xs[j]) * f);
    }
    const m = media(serie);
    const c = serie.map((x) => x - m);
    let mejor = 0, fMejor = 0;
    for (let f = 0.1; f <= 0.5001; f += 0.005) {
      let re = 0, im = 0;
      for (let k = 0; k < c.length; k++) { const w = (2 * Math.PI * f * k) / fs; re += c[k] * Math.cos(w); im -= c[k] * Math.sin(w); }
      const p = re * re + im * im;
      if (p > mejor) { mejor = p; fMejor = f; }
    }
    return Math.round(fMejor * 60);
  }

  const api = { leerMedicion, limpiarRr, rmssd, frDesdeRr };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Vivo = api;
})(typeof window !== "undefined" ? window : globalThis);
