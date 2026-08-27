const flipScene = document.getElementById('flipScene');
const flipCard = flipScene.querySelector('.flip-card');
let flipped = false;
let autoFlipInterval;

function toggleFlip() {
  flipped = !flipped;
  flipCard.classList.toggle('flipped', flipped);
}

function resetAutoFlip() {
  clearInterval(autoFlipInterval);
  autoFlipInterval = setInterval(toggleFlip, 5000);
}

flipScene.addEventListener('click', () => {
  toggleFlip();
  resetAutoFlip();
});

autoFlipInterval = setInterval(toggleFlip, 5000);
