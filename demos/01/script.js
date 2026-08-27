const cards = document.querySelectorAll('.card');
const dots = document.querySelectorAll('.dots .dot');
const pauseBtn = document.getElementById('pauseBtn');
let current = 0;
let interval;
let playing = true;

function show(index) {
  cards.forEach(c => c.classList.remove('active'));
  dots.forEach(d => d.classList.remove('active'));
  cards[index].classList.add('active');
  dots[index].classList.add('active');
}

function next() {
  current = (current + 1) % cards.length;
  show(current);
}

function start() {
  interval = setInterval(next, 3000);
  pauseBtn.textContent = 'Pause';
  playing = true;
}

function stop() {
  clearInterval(interval);
  pauseBtn.textContent = 'Play';
  playing = false;
}

pauseBtn.addEventListener('click', () => {
  if (playing) stop();
  else start();
});

start();
