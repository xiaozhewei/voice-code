const settingsModal = document.getElementById('settings-modal');
const settingsBtn = document.getElementById('settings-btn');
const closeModalBtn = document.getElementById('close-modal-btn');
const themeSelect = document.getElementById('modal-theme-select');

function toggleSettings() {
  console.log('Toggling settings modal. Current visibility:', settingsModal.classList.contains('visible'));
  settingsModal.classList.toggle('visible');
  if (settingsModal.classList.contains('visible')) {
    themeSelect.focus();
    settingsModal.style.display = 'flex'; // Ensure display is flex when visible
    settingsModal.style.opacity = '1';    // Ensure opacity is 1
  } else {
    term.focus();
    setTimeout(() => {
        if (!settingsModal.classList.contains('visible')) {
            settingsModal.style.display = 'none';
        }
    }, 200); // Wait for transition
  }
}

settingsBtn.addEventListener('click', (e) => {
    console.log('Settings button clicked');
    e.stopPropagation(); // Prevent bubbling
    toggleSettings();
});

closeModalBtn.addEventListener('click', toggleSettings);
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) toggleSettings();
});
