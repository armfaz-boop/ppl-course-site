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
      case 'progress':     return renderProgress();
      case 'grade-view':   return renderGradeView(params);
      case 'grade':        return renderGradeFromURL(params);
      default:             return renderHome();
    }
  } catch (err){
    toast('Render error: ' + String(err));
  }
}
window.addEventListener('hashchange', () => render(location.hash));
window.addEventListener('load', () => {
  render(location.hash || '#home');

  // dynamic nav: hide tabs by role
  const navLinks = document.querySelectorAll('header nav a');
  navLinks.forEach(a => {
    const href = a.getAttribute('href');
    if (href === '#lesson' && !isInstructorLike()) a.style.display = 'none';
    if (href === '#progress' && !(roleIsStudent() || isInstructorLike())) a.style.display = 'none';
  });
});

// ============== Views ==============
function renderHome() {
  app.innerHTML = `
    <div class="card">
      <h2>Welcome</h2>
      <p>Use <strong>Assignments</strong> to log in and start assigned quizzes (students),
         or open the grading page (instructors).</p>
      <p><a class="btn" href="#assignments">Go to Assignments</a> 
         <a class="btn" href="#progress">Progress</a></p>
    </div>
  `;
}

function renderLessonFromURL(params) {
  if (!isInstructorLike()) {
    app.innerHTML = `<div class="card"><h2>403</h2><p>Lessons are instructor-only.</p></div>`;
    return;
  }
  const title = params.get('title') || 'Lesson';
  const src   = params.get('src') || '';
  app.innerHTML = `
    <div class="card">
      <h2>${escapeHtml(title)}</h2>
      <div class="card">
        ${src
          ? `<iframe style="width:100%;height:520px" frameborder="0" allowfullscreen src="${src}"></iframe>`
          : `<p><em>No slide src provided. You can launch slides directly in the browser for full animation.</em></p>`}
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
function getSession(){ try { return JSON.parse(localStorage.getItem('ppl_session') || '{}'); } catch { return {}; } }
function setSession(s){ localStorage.setItem('ppl_session', JSON.stringify(s || {})); }
function clearSession(){ localStorage.removeItem('ppl_session'); }
function hasRole(role){ const r=(getSession()?.user?.roles)||[]; return r.includes(role); }
function isInstructorLike(){ const r=(getSession()?.user?.roles)||[]; return r.includes('ground')||r.includes('flight')||r.includes('examiner')||r.includes('instructor'); }
function roleIsStudent(){ const r=(getSession()?.user?.roles)||[]; return r.includes('student'); }

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
      <p>Log in to see quizzes (students) or access grading/lessons (instructors).</p>
      <div class="card">
        <label>Email<br><input id="login_email" type="email" placeholder="you@example.com"></label><br><br>
        <label>Password<br><input id="login_pass" type="password" placeholder="••••••••"></label><br><br>
        <button class="btn" id="login_btn">Log in</button>
        <button class="btn" id="logout_btn" style="display:none">Log out</button>
        <div id="login_msg" style="margin-top:.75rem;color:#b00;"></div>
      </div>
    </div>
  `;
  const btn = document.getElementById('login_btn');
  if (!btn) return toast('Login button not found in DOM');
  btn.addEventListener('click', async () => {
    const email = (document.getElementById('login_email')?.value || '').trim();
    const pass  = (document.getElementById('login_pass')?.value || '').trim();
    const msgEl = document.getElementById('login_msg');
    msgEl.textContent = '';
    if (!email || !pass) { msgEl.textContent = 'Enter email and password.'; return; }
    btn.disabled = true; btn.textContent = 'Logging in…';
    try {
      const out = await loginRequest(email, pass);
      setSession({ token: out.token, user: out.user });
      renderAssignmentsList();
    } catch (err) {
      msgEl.textContent = 'Login failed: ' + String(err.message || err);
      btn.disabled = false; btn.textContent = 'Log in';
    }
  });
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
  document.getElementById('logout_btn')?.addEventListener('click', () => { clearSession(); location.hash = '#assignments'; });

  try {
    const items = await fetchAssignments(sess.token);
    const box = document.getElementById('as_list');
    if (!items.length) { box.innerHTML = `<p><em>No active assignments.</em></p>`; return; }
    box.innerHTML = items.map(a => {
      const topicsQS = encodeURIComponent(a.Topics || '');
      const passQS   = encodeURIComponent(a.Pass || '70');
      const lessonQS = encodeURIComponent(a.Lesson || '');
      const title = escapeHtml(a.Title || a.Lesson || 'Quiz');
      const when  = (a.Window || '').replace('T',' ');

      const quizBtn = roleIsStudent()
        ? `<a class="btn" href="#server-quiz?lesson=${lessonQS}&pass=${passQS}&topics=${topicsQS}">Start quiz</a>`
        : '';

      const gradeBtn = isInstructorLike() && a.ClassID
        ? `<a class="btn" href="#grade?lesson=${lessonQS}&class=${encodeURIComponent(a.ClassID)}">Open grade</a>`
        : '';

      // (Optional slides launcher, requires you store a TemplateID to the assignment if you want)
      const slidesBtn = '';

      return `
        <div class="card" style="margin:.5rem 0">
          <div><strong>${title}</strong></div>
          <div style="font-size:.9rem;color:#555">${escapeHtml(when)}</div>
          <div style="margin-top:.5rem;display:flex;gap:.5rem;flex-wrap:wrap">
            ${quizBtn}${gradeBtn}${slidesBtn}
          </div>
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
  try { questions = await fetchQuizFromServer(topicsSpec); }
  catch (err) {
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

  // Prefill from session and lock
  const sess = getSession();
  const loggedName  = sess?.user?.name || sess?.user?.email || '';
  const loggedEmail = sess?.user?.email || '';
  const nameElInit  = document.getElementById('q_name');
  const emailElInit = document.getElementById('q_email');
  if (nameElInit && loggedName)  { nameElInit.value = loggedName;  nameElInit.disabled = true; }
  if (emailElInit && loggedEmail){ emailElInit.value = loggedEmail; emailElInit.disabled = true; }
  const headerParas = app.querySelectorAll('.card > p');
  if (headerParas && headerParas[0] && loggedEmail) {
    headerParas[0].innerHTML += ` &nbsp; <span style="font-size:.9rem;color:#555">(logged in as ${escapeHtml(loggedEmail)})</span>`;
  }

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
    const sess2   = getSession();
    const name  = ((nameEl?.value || '').trim())  || (sess2?.user?.name || sess2?.user?.email || '');
    const email = ((emailEl?.value || '').trim()) || (sess2?.user?.email || '');

    const showResult = (html) => {
      const box = document.getElementById('q_result');
      box.style.display = 'block';
      box.innerHTML = `<h3>Result</h3><p>${html}</p>`;
    };

    // lock UI
    const submitBtn = document.getElementById('q_submit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.style.pointerEvents = 'none'; submitBtn.style.opacity = '0.6'; setTimeout(() => { submitBtn.style.display = 'none'; }, 50); }
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
      await submitQuizResults({ student: name, email, lesson, score: correctCount, total: norm.length, answers: answersObj, passPercent });
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
    img.style.maxWidth = '100%'; img.style.border = '1px solid #eee'; img.style.borderRadius = '6px'; img.style.height = 'auto';
    if (fig.width) img.style.width = `${fig.width}px`;
    let sidx = 0; img.src = sources[sidx]; img.onerror = () => { sidx += 1; if (sidx < sources.length) img.src = sources[sidx]; };
    const cap = document.createElement('div'); cap.className = 'figure-caption'; cap.style.fontSize = '.85rem'; cap.style.color = '#555'; cap.textContent = `Figure ${fig.number || ''}`;
    figWrap.appendChild(img); figWrap.appendChild(cap); container.appendChild(figWrap);
  }

  const choicesWrap = document.createElement('div');
  choicesWrap.className = 'choices'; choicesWrap.style.display = 'grid'; choicesWrap.style.gap = '.5rem';
  (q.choices || []).forEach((choice, i) => {
    const label = document.createElement('label');
    label.className = 'quiz-choice'; label.style.cursor = 'pointer';
    label.innerHTML = `<input type="radio" name="q${idx}" value="${i}" /> ${escapeHtml(String(choice))}`;
    choicesWrap.appendChild(label);
  });
  container.appendChild(choicesWrap);
  return container;
}

// ============== Student Progress (with totals) ==============
async function fetchStudentProgress(email){
  const { endpoint, secret } = getConfig();
  const url = new URL(endpoint);
  url.searchParams.set('action','student_progress');
  url.searchParams.set('secret', secret);
  url.searchParams.set('email', email);
  const resp = await fetch(url.toString());
  const data = await resp.json().catch(async ()=>({ error: await resp.text() }));
  if (data.error) throw new Error(data.error);
  return data;
}
async function fetchGradeView(email, lessonId){
  const { endpoint, secret } = getConfig();
  const url = new URL(endpoint);
  url.searchParams.set('action','grade_view');
  url.searchParams.set('secret', secret);
  url.searchParams.set('email', email);
  url.searchParams.set('lesson', lessonId);
  const resp = await fetch(url.toString());
  const data = await resp.json().catch(async ()=>({ error: await resp.text() }));
  if (data.error) throw new Error(data.error);
  return data;
}

async function renderProgress(){
  const sess = getSession();
  if (!sess || !sess.user || !sess.user.email) {
    app.innerHTML = `<div class="card"><h2>Progress</h2><p>Please log in first.</p></div>`;
    return;
  }

  const hash = (location.hash || '');
  const [, qs] = hash.replace(/^#/, '').split('?');
  const q = new URLSearchParams(qs || '');
  const paramEmail = (q.get('email') || '').trim();

  const isInstr = isInstructorLike();
  const isStud  = roleIsStudent();
  const targetEmail = isInstr && paramEmail ? paramEmail : (isStud ? sess.user.email : '');

  if (!targetEmail && isInstr) {
    app.innerHTML = `
      <div class="card">
        <h2>Progress (instructor view)</h2>
        <div class="card">
          <label>Student email<br><input id="p_email" type="email" placeholder="student@example.com"></label>
          <button class="btn" id="p_load" style="margin-left:.5rem">Load</button>
        </div>
      </div>
    `;
    document.getElementById('p_load')?.addEventListener('click', () => {
      const e = (document.getElementById('p_email')?.value || '').trim();
      if (!e) return;
      location.hash = `#progress?email=${encodeURIComponent(e)}`;
    });
    return;
  }

  app.innerHTML = `<div class="card"><h2>Progress</h2><div class="card"><em>Loading…</em></div></div>`;

  let data;
  try { data = await fetchStudentProgress(targetEmail); }
  catch (err) {
    app.innerHTML = `<div class="card"><h2>Progress</h2><p style="color:#b00">${escapeHtml(String(err.message||err))}</p></div>`;
    return;
  }

  const who = (targetEmail === sess.user.email) ? (sess.user.name || targetEmail) : targetEmail;
  const totals = data.totals || {groundDay:0,groundNight:0,flightDay:0,flightNight:0,landingsDay:0,landingsNight:0,groundTotal:0,flightTotal:0,landingsTotal:0};
  const lessons = data.lessons || [];

  const rows = lessons.map(l => {
    const color =
      l.Status === 'Satisfactory'   ? '#0a0' :
      l.Status === 'Unsatisfactory' ? '#a00' :
      l.Status === 'Incomplete'     ? '#a60' : '#666';
    const badge = `<span style="display:inline-block;padding:.1rem .4rem;border-radius:4px;border:1px solid #ddd;color:${color}">${escapeHtml(l.Status)}</span>`;
    const canView = (l.Status !== 'Not started');
    const viewHref = `#grade-view?lesson=${encodeURIComponent(l.Lesson)}${isInstr ? `&email=${encodeURIComponent(targetEmail)}` : ''}`;
    return `
      <tr>
        <td>${escapeHtml(l.Lesson)}</td>
        <td>${escapeHtml(l.Title)}</td>
        <td>${badge}</td>
        <td>${escapeHtml(l.Detail || '')}</td>
        <td>${canView ? `<a class="btn" href="${viewHref}">View</a>` : ''}</td>
      </tr>
    `;
  }).join('');

  app.innerHTML = `
    <div class="card">
      <h2>Progress — ${escapeHtml(who)}</h2>
      <div class="card">
        <strong>Totals</strong><br/>
        Ground: ${totals.groundTotal} hr (Day ${totals.groundDay}, Night ${totals.groundNight})<br/>
        Flight: ${totals.flightTotal} hr (Day ${totals.flightDay}, Night ${totals.flightNight})<br/>
        Landings: Day ${totals.landingsDay}, Night ${totals.landingsNight} (Total ${totals.landingsTotal})
      </div>
      <div class="card" style="overflow:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr>
              <th style="text-align:left;padding:6px;border-bottom:1px solid #eee">Lesson</th>
              <th style="text-align:left;padding:6px;border-bottom:1px solid #eee">Title</th>
              <th style="text-align:left;padding:6px;border-bottom:1px solid #eee">Status</th>
              <th style="text-align:left;padding:6px;border-bottom:1px solid #eee">Detail</th>
              <th style="text-align:left;padding:6px;border-bottom:1px solid #eee"> </th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

async function renderGradeView(params){
  const sess = getSession();
  if (!sess || !sess.user || !sess.user.email) { app.innerHTML = `<div class="card"><h2>Grade</h2><p>Please log in first.</p></div>`; return; }

  const lessonId = params.get('lesson') || '';
  const overrideEmail = params.get('email') || '';
  const email = (isInstructorLike() && overrideEmail) ? overrideEmail : (sess.user.email);

  if (!lessonId) { app.innerHTML = `<div class="card"><h2>Grade</h2><p>Missing <code>lesson</code>.</p></div>`; return; }

  app.innerHTML = `<div class="card"><h2>Grade</h2><div class="card"><em>Loading…</em></div></div>`;

  let data;
  try {
    data = await fetchGradeView(email, lessonId);
  } catch (err) {
    app.innerHTML = `<div class="card"><h2>Grade</h2><p style="color:#b00">${escapeHtml(String(err.message||err))}</p></div>`;
    return;
  }
  if (data.error || !data.items) {
    app.innerHTML = `<div class="card"><h2>Grade</h2><p>No grade found yet for ${escapeHtml(lessonId)}.</p></div>`;
    return;
  }

  const header = `
    <div class="card">
      <h2>Grade — ${escapeHtml(lessonId)} <small>(${escapeHtml(data.type)})</small></h2>
      <p><strong>Date:</strong> ${escapeHtml(data.dateISO || '')} • <strong>Status:</strong> ${escapeHtml(data.status || '')} • <strong>U items:</strong> ${Number(data.uCount||0)}</p>
      ${(data.aircraftType || data.tailNumber) ? `<p><strong>A/C:</strong> ${escapeHtml(data.aircraftType||'')}  •  <strong>Tail#:</strong> ${escapeHtml(data.tailNumber||'')}</p>` : ''}
      <p><strong>Time (hr):</strong> Ground Day ${data.times?.groundDay||0}, Ground Night ${data.times?.groundNight||0}, Flight Day ${data.times?.flightDay||0}, Flight Night ${data.times?.flightNight||0}; <strong>Landings:</strong> Day ${data.times?.landingsDay||0}, Night ${data.times?.landingsNight||0}</p>
      ${data.comment ? `<p><strong>Lesson comment:</strong> ${escapeHtml(data.comment)}</p>` : ''}
    </div>
  `;
  const rows = (data.items || []).map(it => {
    const color = it.grade==='S' ? '#0a0' : it.grade==='U' ? '#a00' : it.grade==='I' ? '#a60' : '#666';
    const badge = `<span style="display:inline-block;padding:.1rem .4rem;border-radius:4px;border:1px solid #ddd;color:${color}">${escapeHtml(it.grade||'')}</span>`;
    return `
      <tr>
        <td>${escapeHtml(it.code || '')}</td>
        <td>${escapeHtml(it.desc || '')}</td>
        <td>${badge}</td>
        <td>${escapeHtml(it.comment || '')}</td>
      </tr>
    `;
  }).join('');
  app.innerHTML = `${header}
    <div class="card" style="overflow:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left;padding:6px;border-bottom:1px solid #eee">Item</th>
            <th style="text-align:left;padding:6px;border-bottom:1px solid #eee">Description</th>
            <th style="text-align:left;padding:6px;border-bottom:1px solid #eee">Grade</th>
            <th style="text-align:left;padding:6px;border-bottom:1px solid #eee">Comment</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ============== Grade Sheet (instructor) ==============
async function fetchGradeMeta(lessonId, classId){
  const { endpoint, secret } = getConfig();
  const url = new URL(endpoint);
  url.searchParams.set('action','grade_meta');
  url.searchParams.set('secret', secret);
  url.searchParams.set('lesson', lessonId);
  url.searchParams.set('class', classId);
  const resp = await fetch(url.toString());
  const data = await resp.json().catch(async ()=>({ error: await resp.text() }));
  if (data.error) throw new Error(data.error);
  return data;
}
async function saveGrade(payload){
  const { endpoint, secret } = getConfig();
  const url = new URL(endpoint);
  url.searchParams.set('action','grade_save');
  url.searchParams.set('secret', secret);
  const resp = await fetch(url.toString(), { method: 'POST', body: JSON.stringify(payload) });
  const out = await resp.json().catch(async ()=>({ error: await resp.text() }));
  if (out.error) throw new Error(out.error);
  return out;
}
async function renderGradeFromURL(params){
  if (!isInstructorLike()) { app.innerHTML = `<div class="card"><h2>403</h2><p>Grade sheets are instructor-only.</p></div>`; return; }
  const lessonId = params.get('lesson') || ''; const classId = params.get('class') || '';
  if (!lessonId || !classId) { app.innerHTML = `<div class="card"><h2>Grade</h2><p>Missing <code>lesson</code> or <code>class</code> in URL.</p></div>`; return; }
  app.innerHTML = `<div class="card"><h2>Loading grade sheet…</h2></div>`;

  let meta; try { meta = await fetchGradeMeta(lessonId, classId); }
  catch (err){ app.innerHTML = `<div class="card"><h2>Grade</h2><p style="color:#b00">${escapeHtml(String(err.message||err))}</p></div>`; return; }

  const me = getSession()?.user || {};
  const isExam = (meta?.rules?.lessonType === 'FBE' || meta?.rules?.lessonType === 'FLE');

  app.innerHTML = `
    <div class="card">
      <h2>Grade — ${escapeHtml(meta.lesson.title)} <small>(${escapeHtml(meta.lesson.id)} · ${escapeHtml(meta.lesson.type)})</small></h2>
      <div class="card">
        <label>Student<br>
          <select id="g_student">
            <option value="">— Select —</option>
            ${(meta.students || []).map(s => `<option value="${escapeHtml(s.email)}">${escapeHtml(s.name || s.email)} — ${escapeHtml(s.email)}</option>`).join('')}
          </select>
        </label>
        <br><br>
        <label>Date<br><input id="g_date" type="date" /></label>
        <br><br>
        <label>Instructor email<br><input id="g_instr" type="email" value="${escapeHtml(me.email || '')}" /></label>
      </div>

      <div class="card">
        <h3>Lesson Details</h3>
        <label>Aircraft type (optional)<br><input id="g_acType" type="text" placeholder="e.g. C172S"/></label><br><br>
        <label>Tail number (optional)<br><input id="g_tail" type="text" placeholder="e.g. N12345"/></label><br><br>
        <div style="display:grid;grid-template-columns:repeat(2, minmax(120px,1fr));gap:8px">
          <label>Ground day (hr)<br><input id="g_gday" type="number" step="0.1" min="0" value="0"/></label>
          <label>Ground night (hr)<br><input id="g_gnight" type="number" step="0.1" min="0" value="0"/></label>
          <label>Flight day (hr)<br><input id="g_fday" type="number" step="0.1" min="0" value="0"/></label>
          <label>Flight night (hr)<br><input id="g_fnight" type="number" step="0.1" min="0" value="0"/></label>
          <label>Landings day<br><input id="g_lday" type="number" step="1" min="0" value="0"/></label>
          <label>Landings night<br><input id="g_lnight" type="number" step="1" min="0" value="0"/></label>
        </div>
      </div>

      <div class="card">
        <h3>Line items</h3>
        <div id="g_items"></div>
      </div>

      <div class="card">
        <h3>Lesson status</h3>
        <div id="g_status">U items: 0 — Status: <strong>Pending</strong></div>
        <label>Lesson comment (optional)<br>
          <textarea id="g_comment" rows="3" placeholder="Overall notes…"></textarea>
        </label>
      </div>

      <div>
        <button class="btn" id="g_save">Save grade</button>
        <span id="g_msg" style="margin-left:.75rem"></span>
      </div>
    </div>
  `;

  const itemsWrap = document.getElementById('g_items');
  (meta.lineItems || []).forEach((it, idx) => {
    const row = document.createElement('div');
    row.className = 'card'; row.style.margin = '.5rem 0';
    row.innerHTML = `
      <div><strong>${escapeHtml(it.code)}</strong> — ${escapeHtml(it.desc)}</div>
      <div>
        <label><input type="radio" name="gi${idx}" value="S"> S</label>
        <label><input type="radio" name="gi${idx}" value="I"> I</label>
        <label><input type="radio" name="gi${idx}" value="U"> U</label>
      </div>
      <div>
        <textarea id="gi_c_${idx}" rows="2" placeholder="Comment (required if U)"></textarea>
      </div>
    `;
    row.querySelectorAll(`input[name="gi${idx}"]`).forEach(r => {
      r.addEventListener('change', () => {
        const ta = row.querySelector(`#gi_c_${idx}`);
        if (ta) ta.required = (r.value === 'U');
        updateStatusPreview();
      });
    });
    row.querySelector(`#gi_c_${idx}`)?.addEventListener('input', updateStatusPreview);
    itemsWrap.appendChild(row);
  });
  function collectItems(){
    const out = [];
    (meta.lineItems || []).forEach((it, idx) => {
      const sel = document.querySelector(`input[name="gi${idx}"]:checked`);
      const grade = sel ? sel.value : '';
      const comment = (document.getElementById(`gi_c_${idx}`)?.value || '').trim();
      out.push({ code: it.code, desc: it.desc, grade, comment });
    });
    return out;
  }
  function updateStatusPreview(){
    const items = collectItems();
    const uCount = items.reduce((n, it)=> n + (it.grade==='U' ? 1 : 0), 0);
    let status = 'Pending';
    if (items.every(it => it.grade)) status = isExam ? (uCount===0 ? 'S' : 'U') : (uCount<=2 ? 'S' : 'U');
    const box = document.getElementById('g_status');
    if (box) box.innerHTML = `U items: ${uCount} — Status: <strong>${status}</strong>`;
  }
  updateStatusPreview();

  document.getElementById('g_save')?.addEventListener('click', async () => {
    const msgEl = document.getElementById('g_msg'); msgEl.style.color = '#333'; msgEl.textContent = 'Saving…';
    const studentSel = document.getElementById('g_student');
    const studentEmail = (studentSel?.value || '').trim();
    const studentName  = studentSel?.options[studentSel.selectedIndex || 0]?.text?.split(' — ')[0] || '';
    const dateISO      = (document.getElementById('g_date')?.value || '').trim();
    const instructorEmail = (document.getElementById('g_instr')?.value || '').trim();

    const payload = {
      lesson: meta.lesson.id,
      lessonType: meta.lesson.type,
      classId: classId,
      studentEmail, studentName, instructorEmail,
      dateISO,
      aircraftType: (document.getElementById('g_acType')?.value || '').trim(),
      tailNumber:   (document.getElementById('g_tail')?.value || '').trim(),
      groundDay:  Number(document.getElementById('g_gday')?.value || 0) || 0,
      groundNight:Number(document.getElementById('g_gnight')?.value || 0) || 0,
      flightDay:  Number(document.getElementById('g_fday')?.value || 0) || 0,
      flightNight:Number(document.getElementById('g_fnight')?.value || 0) || 0,
      landingsDay:Number(document.getElementById('g_lday')?.value || 0) || 0,
      landingsNight:Number(document.getElementById('g_lnight')?.value || 0) || 0,
      items: collectItems(),
      lessonComment: (document.getElementById('g_comment')?.value || '').trim()
    };

    try {
      const out = await saveGrade(payload);
      msgEl.style.color = '#060';
      msgEl.textContent = `Saved — Status: ${out.status} (U=${out.uCount})`;
    } catch (err) {
      msgEl.style.color = '#b00';
      msgEl.textContent = `Save error: ${String(err.message || err)}`;
    }
  });
}

// ============== Utils ==============
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m] )); }
function idxToLetter(i){ return ['A','B','C','D'][Number(i)] || ''; }
