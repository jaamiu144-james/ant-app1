/* ---------------------------------------------------------------------
   pwa-install.js — shared by pricing.html, login.html and the app shell
   (appBundle.js injects a matching <script src="/pwa-install.js">).
   Registers the service worker and shows any #pwa-install-btn on the
   page once the browser signals the app is installable.

   Install-button visibility is driven by a class on <html> rather than
   touching a specific button element directly — the app's own topbar
   button (src/app.js renderTopbarRight) doesn't exist in the DOM yet
   when this script first runs (it's rendered after the app finishes
   booting), so setting `.hidden` on "the button" at event time would
   miss it entirely. A CSS rule keyed off the class shows *any* matching
   button, whenever it happens to mount.
--------------------------------------------------------------------- */
(function(){
  const style = document.createElement('style');
  style.textContent = '#pwa-install-btn{display:none} html.pwa-installable #pwa-install-btn{display:inline-flex}';
  document.head.appendChild(style);

  if('serviceWorker' in navigator){
    window.addEventListener('load', ()=>{
      navigator.serviceWorker.register('/sw.js').catch(err=> console.warn('Service worker registration failed', err));
    });
  }

  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    document.documentElement.classList.add('pwa-installable');
  });

  window.addEventListener('appinstalled', ()=>{
    deferredPrompt = null;
    document.documentElement.classList.remove('pwa-installable');
  });

  document.addEventListener('click', (e)=>{
    if(e.target && e.target.id === 'pwa-install-btn' && deferredPrompt){
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(()=>{
        deferredPrompt = null;
        document.documentElement.classList.remove('pwa-installable');
      });
    }
  });
})();
