const { app, BrowserWindow } = require('electron');

function createWindow () {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800
  });

  // Load your live Firebase hosting URL here
  mainWindow.loadURL('https://fearless-leader.web.app');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});