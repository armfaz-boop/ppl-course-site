// ============== Tiny in-page logger ==============
function toast(msg){
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = String(msg);
  t.style.display = 'block';
}
window.addEventListener('error', e => toast('JS error: ' + (e.message || e.error || 'unknown')));

// ============== Router ==============
const app = document.getElementById('app');

function render(route) {
  try {
    const hash = (route || '').replace(/^#/, '');
    const [base, qs] = hash.split('?');
    const params = new URLSearchParams(qs || '');
    switch ((base || 'home').toLowerCase()) {
      case 'server-quiz':  return renderServerQuizFromURL(params);
      case 'lesson':       return renderLessonFromURL(params);
      case 'assignments':  return renderAssignmentsGate();
      default:             return renderHome();
    }
  } catch (err){
    toast('Render error: ' + String(err));
  }
}
window.addEventListener('hashchange', () => render(location.hash));
window.addEventListener('load', () => render(location.hash || '#home'));

// ============== Views ==============
function renderHome() {
  app.innerHTML = `
    <div class="card">
      <h2>Welcome</h2>
      <p>Use <strong>Assignments</strong> to log in and start assigned quizzes.</p>
      <h3>Examples</h3>
      <ul>
        <li>Lesson: <code>#lesson?title=Regs&src=PASTE_SLIDES_EMBED_SRC</code></li>
        <li>Quiz (multi): <code>#server-quiz?lesson=KBQ1&pass=70&topics=G1.PGENINST-K:4,G5.PWTBAL-K:4,G6.PACPERFP-K:3,K2.PLTQALREG-K:6,K1.PFPREP-K:3</code></li>
      </ul>
      <p><a class="btn" href="#assignments">Go to Assignments</a></p>
    </div>
  `;
}

function renderLessonFromURL(params) {
  const title = params.get('title') || 'Lesson';
  const src   = params.get('src') || '';
  app.innerHTML = `
    <div class="card">
      <h2>${escapeHtml(title)}</h2>
      <div class="card">
        ${src
          ? `<iframe style="width:100%;height:520px" frameborder="0" allowfullscreen src="${src}"></iframe>`
          : `<p><em>No slide src provided. Publish to web → Embed, then paste the iframe <code>src</code> as the "src" param.</em></p>`}
      </div>
    </div>
  `;
}

// ============== Auth + Assignments ==============
function getConfig(){
  const cfg = (window.APP_CONFIG || {});
  if (!cfg.SCRIPT_ENDPOINT) toast('CONFIG: missing SCRIPT_ENDPOINT');
  if (!cfg.SHARED_SECRET)  toast('CONFIG: missing SHARED_SECRET');
  return { endpoint: cfg.SCRIPT_ENDPOINT, secret: cfg.SHARED_SECRET };
}

function getSession(){
  try { return JSON.parse(localStorage.getItem('ppl_session') || '{}'); }
  catch { return {}; }
}
function setSession(s){ localStorage.setItem('ppl_session', JSON.stringify(s || {})); }
function clearSession(){ localStorage.removeItem('ppl_session'); }

async function loginRequest(email, pass){
  const { endpoint } = getConfig();
  const url = new URL(endpoint);
  url.searchParams.set('action','login');
  url.searchParams.set('user', email);
  url.searchParams.set('pass', pass);
  const resp = await fetch(url.toString());
  const data = await resp.json().catch(async ()=>({ error: await resp.text() }));
  if (data.error) throw new Error(data.error);
  return data; // {token, user, build}
}

async function fetchAssignments(token){
  const { endpoint } = getConfig();
  const url = new URL(endpoint);
  url.searchParams.set('action','assignments');
  url.searchParams.set('token', token);
  const resp = await fetch(url.toString());
  const data = await resp.json().catch(async ()=>({ error: await resp.text() }));
  if (data.error) throw new Error(data.error);
  return data.assignments || [];
}

function renderAssignmentsGate(){
  app.innerHTML = `
    <div class="card">
      <h2>Assignments</h2>
      <p>Log in to see quizzes assigned to your class.</p>
      <div class="card">
        <label>Email<br><input id="login_email" type="email" placeholder="you@example.com"></label><br><br>
        <label>Password<br><input id="login_pass" type="password" placeholder="••••••••"></label><br><br>
        <button class="btn" id="login_btn">Log in</button>
        <button class="btn" id="logout_btn" style="display:none">Log out</button>
        <div id="login_msg" style="margin-top:.75rem;color:#b00;"></div>
      </div>
    </div>
  `;

  // Attach handler robustly
  const btn = document.getElementById('login_btn');
  if (!btn) return toast('Login button not found in DOM');
  btn.addEventListener('click', async () => {
    const email = (document.getElementById('login_email')?.value || '').trim();
    const pass  = (document.getElementById('login_pass')?.value || '').trim();
    const msgEl = document.getElementById('login_msg');
    msgEl.textContent = '';
    if (!email || !pass) {
      msgEl.textContent = 'Enter email and password.';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Logging in…';
    try {
      const out = await loginRequest(email, pass);
      setSession({ token: out.token, user: out.user });
      renderAssignmentsList();
    } catch (err) {
      msgEl.textContent = 'Login failed: ' + String(err.message || err);
      btn.disabled = false;
      btn.textContent = 'Log in';
    }
  });

  // If a session already exists, flip right to list
  const sess = getSession();
  if (sess && sess.token) renderAssignmentsList();
}

async function renderAssignmentsList(){
  const sess = getSession();
  if (!sess || !sess.token) return renderAssignmentsGate();

  app.innerHTML = `
    <div class="card">
      <h2>Assignments</h2>
      <p>Logged in as <strong>${escapeHtml(sess.user?.name || sess.user?.email || '')}</strong>
        <button class="btn" id="logout_btn" style="float:right">Log out</button></p>
      <div id="as_list" class="card"><em>Loading…</em></div>
    </div>
  `;
  const lo = document.getElementById('logout_btn');
  if (lo) lo.onclick = () => { clearSession(); location.hash = '#assignments'; };

  try {
    const items = await fetchAssignments(sess.token);
    const box = document.getElementById('as_list');
    if (!items.length) {
      box.innerHTML = `<p><em>No active assignments.</em></p>`;
      return;
    }
    box.innerHTML = items.map(a => {
      const topicsQS = encodeURIComponent(a.Topics || '');
      const passQS   = encodeURIComponent(a.Pass || '70');
      const lessonQS = encodeURIComponent(a.Lesson || '');
      const href = `#server-quiz?lesson=${lessonQS}&pass=${passQS}&topics=${topicsQS}`;
      const title = escapeHtml(a.Title || a.Lesson || 'Quiz');
      const when  = (a.Window || '').replace('T',' ');
      return `
        <div class="card" style="margin:.5rem 0">
          <div><strong>${title}</strong></div>
          <div style="font-size:.9rem;color:#555">${escapeHtml(when)}</div>
          <div style="margin-top:.5rem"><a class="btn" href="${href}">Start</a></div>
        </div>
      `;
    }).join('');
  } catch (err) {
    toast('Assignments error: ' + String(err.message || err));
    const box = document.getElementById('as_list');
    if (box) box.innerHTML = `<p style="color:#b00">Error: ${escapeHtml(err.message || err)}</p>`;
  }
}

// ============== Quiz helpers ==============
async function fetchQuizFromServer(topicsSpec) {
  const { endpoint, secret } = getConfig();
  const url = new URL(endpoint);
  url.searchParams.set('action', 'quiz');
  url.searchParams.set('secret', secret);
  url.searchParams.set('topics', topicsSpec);
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`Quiz HTTP ${resp.status}`);
  const data = await resp.json().catch(async ()=>({ error: await resp.text() }));
  if (data.error) throw new Error(data.error);
  return data.questions || [];
}

async function submitQuizResults({ student, email, lesson, score, total, answers, passPercent }) {
  const { endpoint, secret } = getConfig();
  const url = new URL(endpoint);
  url.searchParams.set('action', 'submit');
  url.searchParams.set('secret', secret);
  const resp = await fetch(url.toString(), {
    method: 'POST',
    body: JSON.stringify({ student, email, lesson, score, total, answers, passPercent })
  });
  if (!resp.ok) {
    const text = await resp.text().catch(()=>'(no body)');
    throw new Error(`Submit HTTP ${resp.status}: ${text.slice(0,200)}`);
  }
  const out = await resp.json().catch(async ()=>({ error: await resp.text() }));
  if (out.error) throw new Error(out.error);
  return out;
}

// ============== Quiz view ==============
async function renderServerQuizFromURL(params) {
  const lesson      = params.get('lesson') || '';
  const passPercent = Number(params.get('pass') || 70);
  const topicsSpec  = params.get('topics') || '';

  app.innerHTML = `<div class="card">
    <p>Contacting server…</p>
    <p><small>Topics: <code>${escapeHtml(topicsSpec)}</code></small></p>
  </div>`;

  let questions;
  try {
    questions = await fetchQuizFromServer(topicsSpec);
  } catch (err) {
    app.innerHTML = `<div class="card"><h3>Quiz error</h3><p>${escapeHtml(err.message || String(err))}</p></div>`;
    return;
  }

  const norm = questions.map(q => ({
    id: q.id,
    text: q.q || q.text || '',
    choices: q.choices || [],
    correct: (q.correct || '').toString().toUpperCase(),
    explanation: q.explanation || '',
    figure: q.figure || null
  }));

  app.innerHTML = `
    <div class="card">
      <h2>Quiz</h2>
      <p><strong>Lesson:</strong> ${escapeHtml(lesson || '(unspecified)')} • <strong>Passing:</strong> ${passPercent}%</p>

      <div class="card">
        <label>Name<br><input id="q_name" type="text" placeholder="Your name"/></label><br><br>
        <label>Email<br><input id="q_email" type="email" placeholder="you@example.com"/></label>
      </div>

      <div id="q_list"></div>

      <div style="margin-top:1rem">
        <button class="btn" id="q_submit">Submit</button>
      </div>

      <div id="q_result" class="card" style="display:none"></div>
    </div>
  `;

  const qList = document.getElementById('q_list');
  const selections = new Array(norm.length).fill(null);
  norm.forEach((q, idx) => {
    const node = renderQuizQuestion(q, idx);
    node.querySelectorAll('input[type=radio]').forEach(r => {
      r.addEventListener('change', () => { selections[idx] = Number(r.value); });
    });
    qList.appendChild(node);
  });

  document.getElementById('q_submit')?.addEventListener('click', async () => {
    const nameEl  = document.getElementById('q_name');
    const emailEl = document.getElementById('q_email');
    const name  = (nameEl?.value || '').trim();
    const email = (emailEl?.value || '').trim();

    const showResult = (html) => {
      const box = document.getElementById('q_result');
      box.style.display = 'block';
      box.innerHTML = `<h3>Result</h3><p>${html}</p>`;
    };

    // lock UI
    const submitBtn = document.getElementById('q_submit');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.pointerEvents = 'none';
      submitBtn.style.opacity = '0.6';
      setTimeout(() => { submitBtn.style.display = 'none'; }, 50);
    }
    if (nameEl)  nameEl.disabled  = true;
    if (emailEl) emailEl.disabled = true;
    document.querySelectorAll('#q_list input[type=radio]').forEach(el => el.disabled = true);

    // grade locally
    let correctCount = 0;
    const answersObj = {};
    norm.forEach((q, i) => {
      const choiceIdx = selections[i];
      const chosenLetter = idxToLetter(choiceIdx);
      answersObj[q.id] = chosenLetter || '';
      if ((chosenLetter || '') === q.correct) correctCount++;
    });

    const scorePct = Math.round((correctCount / norm.length) * 100);
    const passed   = scorePct >= passPercent;

    try {
      await submitQuizResults({
        student: name,
        email,
        lesson,
        score: correctCount,
        total: norm.length,
        answers: answersObj,
        passPercent
      });
      showResult(`Score: <strong>${scorePct}%</strong> (${correctCount} / ${norm.length})<br>Status: ${passed ? '✅ PASS' : '❌ FAIL'}`);
    } catch (err) {
      const msg = String(err.message || err);
      const friendly = msg.includes('already_submitted')
        ? 'An attempt for this lesson already exists for your account. Ask your instructor if a retake should be enabled.'
        : 'Submit error: ' + escapeHtml(msg);
      showResult(friendly);
    }
  });
}

// ============== Question renderer ==============
function renderQuizQuestion(q, idx) {
  const container = document.createElement('div');
  container.className = 'question';

  const qText = document.createElement('div');
  qText.innerHTML = `<strong>Q${idx + 1}.</strong> ${escapeHtml(q.text)}`;
  container.appendChild(qText);

  const fig = q.figure || null;
  const sources = [];
  if (fig) {
    if (fig.url) sources.push(fig.url);
    if (fig.altUrl) sources.push(fig.altUrl);
    if (fig.thumb) sources.push(fig.thumb);
  }
  if (sources.length) {
    const figWrap = document.createElement('div');
    figWrap.className = 'quiz-figure';
    figWrap.style.margin = '.5rem 0 1rem';

    const img = document.createElement('img');
    img.alt = `Figure ${fig.number || ''}`;
    img.style.maxWidth = '100%';
    img.style.border = '1px solid #eee';
    img.style.borderRadius = '6px';
    img.style.height = 'auto';
    if (fig.width) img.style.width = `${fig.width}px`;

    let sidx = 0;
    img.src = sources[sidx];
    img.onerror = () => { sidx += 1; if (sidx < sources.length) img.src = sources[sidx]; };

    const cap = document.createElement('div');
    cap.className = 'figure-caption';
    cap.style.fontSize = '.85rem';
    cap.style.color = '#555';
    cap.textContent = `Figure ${fig.number || ''}`;

    figWrap.appendChild(img);
    figWrap.appendChild(cap);
    container.appendChild(figWrap);
  }

  const choicesWrap = document.createElement('div');
  choicesWrap.className = 'choices';
  choicesWrap.style.display = 'grid';
  choicesWrap.style.gap = '.5rem';

  (q.choices || []).forEach((choice, i) => {
    const label = document.createElement('label');
    label.className = 'quiz-choice';
    label.style.cursor = 'pointer';
    label.innerHTML = `
      <input type="radio" name="q${idx}" value="${i}" />
      ${escapeHtml(String(choice))}
    `;
    choicesWrap.appendChild(label);
  });

  container.appendChild(choicesWrap);
  return container;
}

// ============== Utils ==============
function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, m => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]
  ));
}
function idxToLetter(i){ return ['A','B','C','D'][Number(i)] || ''; }
