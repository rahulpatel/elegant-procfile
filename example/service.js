const process = require('process');

let i = 0;
const interval = setInterval(() => {
    console.log(i)
    i++
}, Math.random() * 1000);

process.on('SIGINT', () => {
  console.log('clearning interval');
  clearInterval(interval);
});
