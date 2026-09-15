const app = document.querySelector<HTMLElement>('#app');

if (app) {
  app.innerHTML = `
    <h1>今日時間軸</h1>
    <div class="card stack">
      <p>今日時間軸會在「批次 2:一天的時間」加入。</p>
      <p class="muted small">到時候這裡會依時間顯示今天的工作時段、固定行程、正在計時的工作,以及當日統計。</p>
    </div>
  `;
}
