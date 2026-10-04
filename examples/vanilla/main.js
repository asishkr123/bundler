import { greeting } from './message.js';
document.querySelector('#message').textContent = greeting('developer');
document.querySelector('#load-more').addEventListener('click', async () => {
  const { loadFeature } = await import('./feature.js');
  loadFeature();
});
