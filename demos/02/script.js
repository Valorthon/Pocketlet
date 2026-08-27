const phone = document.querySelector('.phone');
const bullets = document.querySelectorAll('.bullet');

window.addEventListener('load', () => {
  setTimeout(() => phone.classList.add('visible'), 300);
  bullets.forEach((b, i) => {
    setTimeout(() => b.classList.add('visible'), 800 + (i * 900));
  });
});
