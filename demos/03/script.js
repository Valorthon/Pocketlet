const stepLabel = document.getElementById('stepLabel');
const replayBtn = document.getElementById('replayBtn');
const scenes = document.querySelectorAll('.scene');
const labels = ['Onboarding', 'Passkey Auth', 'Home', 'Send', 'PIN', 'Success'];
const durations = [2500, 2500, 2000, 3000, 2500, 3500];
let timeouts = [];

function showScene(index) {
  scenes.forEach(s => s.classList.remove('active'));
  scenes[index].classList.add('active');
  stepLabel.textContent = labels[index];
}

function clearAllTimeouts() {
  timeouts.forEach(t => clearTimeout(t));
  timeouts = [];
}

function play() {
  clearAllTimeouts();
  showScene(0);

  let delay = 0;
  for (let i = 1; i < scenes.length; i++) {
    delay += durations[i - 1];
    timeouts.push(setTimeout(() => showScene(i), delay));
  }
}

replayBtn.addEventListener('click', play);

window.addEventListener('load', play);
