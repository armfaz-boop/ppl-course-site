/***********************
 * CONFIG & STATE
 ***********************/
const CFG = window.APP_CONFIG || {};
const ENDPOINT = CFG.SCRIPT_ENDPOINT;
const SECRET   = CFG.SHARED_SECRET;

let currentUser = null;
let currentToken = '';
let currentQuiz = null;

/***********************
 * DOM HELPERS
 ***********************/
function $(id){ return document.getElementById(id); }
function showPage(id){
  document.querySelectorAll('section').forEach(sec => sec.classList.add('hidden'));
  $(id).classList.remove('hidden');
}
function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, m => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]
  ));
}
function idxToLetter(i){ return ['A','B','C','D'][Number(i)] || ''; }

/***********************
 * API HELPERS
 * (GET for login/assignments/quiz, POST for submit)
 ***********************/
async function apiGet(params){
  const url = new URL(ENDPOINT);
  Object.entries(params||{}).forEach(([k,v]) => url.searchParams.set(k, v));
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json().catch(async ()=>({ error: await resp.text() }));
  if (data.error) throw new Error(data.error);
  return data;
}
async function apiPost(params, body){
  const url = new URL(ENDPOINT);
  Object.entries(params||{}).forEach(([k,v]) => url.searchParams.set(k, v));
  const resp = await fetch(url.toString(), {
    method:'POST',
    body: JSON.stringify(body||{})
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json().catch(async ()=>({ error: await resp.text() }));
  if (data.error) throw new Error(data.error);
  return data;
}

/***********************
 * AUTH
 ***********************/
async function login(){
  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value;
  const status = $('loginStatus');
  status.textContent = 'Signing in…';
  try{
    // Apps Script expects GET: action=login&user=&pass=
    const out = await apiGet({ action:'login', user: username, pass: password });
    currentToken = out.token;
    currentUser  = out.user;
    status.textContent = `Welcome, ${escapeHtml(currentUser.name || currentUser.email)}`;
    showPage('assignmentsPage');
    loadAssignments();
  }catch(err){
    status.textContent = 'Login failed: ' + (err.message || String(err));
  }
}
function logout(){
  currentUser = null;
  currentToken = '';
  currentQuiz = null;
  $('loginUsername').value = '';
  $('loginPassword').value = '';
  $('loginStatus').textContent = '';
  showPage('loginPage');
}

/***********************
 * ASSIGNMENTS (student)
 ***********************/
async function loadAssignments(){
  if (!currentToken){ showPage('loginPage'); return; }
  const list = $('assignmentsList');
  list.textContent = 'Loading…';
  try{
    // Apps Script expects GET: action=assignments&token=
    const out = await apiGet({ action:'assignments', token: currentToken });
    const items = out.assignments || [];
    if (!items.length){
      list.innerHTML = '<em>No active assignments.</em>';
      return;
    }
    list.innerHTML = '';
    items.forEach(a => {
      const div = document.createElement('div');
      div.className = 'assignment';
      const dur = a.DurationMin ? ` • ${a.DurationMin} min` : '';
      div.innerHTML = `
        <b>${escapeHtml(a.Title || a.Lesson)}</b>
        <div class="muted">Lesson: ${escapeHtml(a.Lesson)} • Pass ${a.Pass}%${dur}</div>
        <button data-lesson="${escapeHtml(a.Lesson)}"
                data-topics="${escapeHtml(a.Topics || '')}"
                data-pass="${Number(a.Pass||70)}">Start</button>
      `;
      const btn = div.querySelector('button');
      btn.onclick = () => startQuiz(btn.getAttribute('data-lesson'),
                                     btn.getAttribute('data-topics')||'',
                                     Number(btn.getAttribute('data-pass')||70));
      list.appendChild(div);
    });
  }catch(err){
    list.textContent = 'Error: ' + (err.message || String(err));
  }
}

/***********************
 * QUIZ (fetch, render, submit)
 ***********************/
async function fetchQuiz(topicsSpec){
  // Apps Script expects GET: action=quiz&secret=&topics=
  const out = await apiGet({ action:'quiz', secret: SECRET, topics: topicsSpec });
  return out.questions || [];
}

async function startQuiz(lesson, topicsSpec, passPercent){
  if (!topicsSpec){
    alert('This assignment has no Topics set in QuizCatalog.');
    return;
  }
  $('quizTitle').textContent = `${lesson}`;
  $('quizStatus').textContent = '';
  const form = $('quizForm');
  form.innerHTML = 'Loading questions…';
  try{
    const questions = await fetchQuiz(topicsSpec);
    currentQuiz = { lesson, passPercent, questions };
    form.innerHTML = '';
    questions.forEach((q, i) => {
      // Back-end returns { id, text, choices, correct, ... }
      const div = document.createElement('div');
      div.innerHTML = `
        <p>${i+1}. ${escapeHtml(q.text || q.q || '')}</p>
        ${(q.choices || q.options || []).map((opt, j) =>
          `<label><input type="radio" name="q${i}" value="${j}"> ${escapeHtml(String(opt))}</label><br>`
        ).join('')}
      `;
      form.appendChild(div);
      // Optional figure
      if (q.figure){
        const fwrap = document.createElement('div');
        const img = document.createElement('img');
        img.style.maxWidth = '100%';
        const sources = [q.figure.url, q.figure.altUrl, q.figure.thumb].filter(Boolean);
        let s = 0; img.src = sources[s];
        img.onerror = () => { s += 1; if (s < sources.length) img.src = sources[s]; };
        fwrap.appendChild(img);
        const cap = document.createElement('div');
        cap.textContent = `Figure ${q.figure.number||''}`;
        cap.style.color = '#666';
        cap.style.fontSize = '0.9em';
        form.appendChild(fwrap);
        form.appendChild(cap);
      }
    });
    showPage('quizPage');
  }catch(err){
    $('quizStatus').textContent = 'Quiz error: ' + (err.message || String(err));
  }
}

async function submitQuiz(){
  if (!currentQuiz){ return; }
  const form = $('quizForm');
  // grade locally
  let correct = 0;
  const answersObj = {};
  currentQuiz.questions.forEach((q, i) => {
    const picked = form.querySelector(`input[name="q${i}"]:checked`);
    const choiceIdx = picked ? Number(picked.value) : null;
    const letter = idxToLetter(choiceIdx);
    answersObj[q.id] = letter || '';
    if ((letter||'') === (q.correct||'')) correct += 1;
  });
  const total = currentQuiz.questions.length;
  const pct = Math.round((correct/total)*100);
  const passed = pct >= (currentQuiz.passPercent || 70);

  $('quizStatus').textContent = 'Submitting…';
  try{
    // Apps Script expects POST action=submit&secret=..., body has student/email/lesson/score/total/answers
    const nameEl  = $('loginUsername'); // if you want to collect name/email separately, add inputs to the quiz page
    const emailEl = $('loginUsername'); // placeholder: using username field for demo
    const studentName = currentUser?.name || '';
    const email       = currentUser?.email || '';

    await apiPost({ action:'submit', secret: SECRET }, {
      student: studentName,
      email,
      lesson: currentQuiz.lesson,
      score: correct,
      total,
      answers: answersObj,
      passPercent: currentQuiz.passPercent || 70
    });
    $('quizStatus').innerHTML = `Score: <b>${pct}%</b> (${correct}/${total}) • ${passed ? '✅ PASS' : '❌ FAIL'}`;
    // return to assignments after a beat
    setTimeout(()=>{ showPage('assignmentsPage'); loadAssignments(); }, 1200);
  }catch(err){
    $('quizStatus').textContent = 'Submit error: ' + (err.message || String(err));
  }
}

/***********************
 * INITIAL VIEW
 ***********************/
showPage('loginPage');  // default start
