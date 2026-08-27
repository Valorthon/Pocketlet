const milestones = document.querySelectorAll('.milestone');

window.addEventListener('load', () => {
  milestones[0].classList.add('visible');
  setTimeout(() => milestones[1].classList.add('visible'), 1500);
  setTimeout(() => milestones[2].classList.add('visible'), 3000);
});
