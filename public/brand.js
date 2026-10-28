// Universitet belgisi. Nomlarni shu yerda o'zgartirish mumkin.
// Rasmiy logotip bo'lsa, uni "public/logo.png" nomi bilan qo'ying — emblema o'rniga o'sha chiqadi.
window.BRAND = {
  university: 'Profi University',
  faculty: 'Iqtisodiyot fakulteti',
  game: 'Iqtisodiy bilimlar bellashuvi',
};
window.brandHtml = function (large, subtitle) {
  const B = window.BRAND;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<div class="brandbar ${large ? 'lg' : ''}">
    <img class="emb" src="logo.png" alt="" onerror="this.onerror=null;this.src='emblem.svg'">
    <div style="min-width:0"><div class="uni">${esc(B.university)} · ${esc(B.faculty)}</div>
      <div class="ttl">${esc(subtitle || B.game)}</div></div></div>`;
};
