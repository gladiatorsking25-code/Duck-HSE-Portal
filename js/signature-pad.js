function attachSignaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#16232c';
  let drawing = false;
  let last = null;
  let hasContent = false;

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return {
      x: (p.clientX - rect.left) * (canvas.width / rect.width),
      y: (p.clientY - rect.top) * (canvas.height / rect.height)
    };
  }
  function start(e) {
    if (canvas.disabled) return;
    e.preventDefault();
    drawing = true;
    last = pos(e);
  }
  function move(e) {
    if (!drawing || canvas.disabled) return;
    e.preventDefault();
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
    hasContent = true;
  }
  function end() { drawing = false; }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  canvas.clearPad = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); hasContent = false; };
  canvas.isEmpty = () => !hasContent;
  canvas.toDataUrlSafe = () => hasContent ? canvas.toDataURL('image/png') : null;
  canvas.loadDataUrl = (dataUrl) => {
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => { ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); hasContent = true; };
    img.src = dataUrl;
  };
  canvas.setDisabled = (disabled) => { canvas.disabled = disabled; canvas.style.opacity = disabled ? '0.85' : '1'; };
}
