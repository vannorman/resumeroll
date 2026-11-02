(function () {
    'use strict';

    /* ---------- helpers ---------- */
    function h(tag, props) {
        var el = document.createElement(tag);
        props = props || {};
        Object.keys(props).forEach(function (k) {
            var v = props[k];
            if (v == null || v === false) return;
            if (k === 'class') el.className = v;
            else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
            else if (k === 'value' || k === 'checked') el[k] = v;
            else if (v === true) el.setAttribute(k, '');
            else el.setAttribute(k, v);
        });
        for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
        return el;
    }
    function append(el, c) {
        if (c == null || c === false) return;
        if (Array.isArray(c)) return c.forEach(function (x) { append(el, x); });
        el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    function api(path, opts) {
        opts = opts || {};
        var init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
        if (opts.body instanceof FormData) init.body = opts.body;
        else if (opts.body !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(opts.body);
        }
        return fetch('/api' + path, init).then(function (r) {
            if (r.status === 401 && path !== '/login') { showLogin(); throw new Error('auth required'); }
            return r.json().catch(function () { return {}; }).then(function (j) {
                if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
                return j;
            });
        });
    }

    function toast(msg) {
        var t = h('div', { class: 'toast' }, msg);
        document.body.appendChild(t);
        setTimeout(function () { t.remove(); }, 3200);
    }
    function fail(e) { toast(e.message || String(e)); }

    function ago(d) {
        if (!d) return '';
        var s = (Date.now() - new Date(d).getTime()) / 1000;
        if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
        if (s < 86400) return Math.round(s / 3600) + 'h ago';
        return Math.round(s / 86400) + 'd ago';
    }
    function money(n) {
        if (!n) return '';
        return n >= 1000 ? '$' + Math.round(n / 1000) + 'k' : '$' + n;
    }
    function salaryText(j) {
        if (!j.salaryMin && !j.salaryMax) return 'Salary n/a';
        var a = money(j.salaryMin), b = money(j.salaryMax);
        var s = a && b && a !== b ? a + '–' + b : (a || b);
        return s + (j.salaryEstimated ? ' (est.)' : '');
    }
    function lines(s) { return String(s || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
    function list(s) { return String(s || '').split(/[\n,]/).map(function (x) { return x.trim(); }).filter(Boolean); }

    function field(label, input) { return h('label', { class: 'f' }, h('span', null, label), input); }
    function txt(v, type) { return h('input', { type: type || 'text', value: v == null ? '' : v }); }
    function area(v, rows) { return h('textarea', { rows: rows || 3, value: v == null ? '' : v }); }

    var root = document.getElementById('root');
    var state = { view: 'pipeline', group: 'review', stats: null, pollTimer: null };

    /* ---------- login ---------- */
    function showLogin() {
        clear(root);
        var err = h('div', { class: 'err' });
        var pw = h('input', { type: 'password', placeholder: 'Password', autofocus: true });
        var form = h('form', {
            onsubmit: function (e) {
                e.preventDefault();
                api('/login', { method: 'POST', body: { password: pw.value } })
                    .then(boot).catch(function (x) { err.textContent = x.message; });
            }
        },
            h('h1', null, 'ResumeRoll'),
            h('div', { class: 'sub', style: 'margin-bottom:18px' }, 'Sign in'),
            pw,
            err,
            h('button', { class: 'btn primary', style: 'width:100%;margin-top:10px', type: 'submit' }, 'Continue')
        );
        root.appendChild(h('div', { class: 'login' }, form));
    }

    /* ---------- shell ---------- */
    var NAV = [
        ['pipeline', 'Pipeline'],
        ['assets', 'Assets'],
        ['profile', 'Candidate Profile'],
        ['search', 'Search Settings'],
        ['runs', 'Runs']
    ];

    function shell() {
        clear(root);
        var nav = h('div', { class: 'nav' });
        NAV.forEach(function (n) {
            var count = n[0] === 'pipeline' && state.stats ? h('span', { class: 'count' }, state.stats.counts.review) : null;
            nav.appendChild(h('a', {
                class: state.view === n[0] ? 'active' : '',
                href: '#/' + n[0]
            }, h('span', null, n[1]), count));
        });
        var side = h('div', { class: 'side' },
            h('div', { class: 'brand' }, h('div', { class: 'mark' }, 'R'), 'ResumeRoll'),
            nav,
            h('div', { class: 'spacer' }),
            h('div', { class: 'foot' }, 'charlie@vannorman.ai', h('br'),
                h('button', { onclick: function () { api('/logout', { method: 'POST' }).then(showLogin); } }, 'Sign out'))
        );
        var main = h('div', { class: 'main', id: 'main' });
        root.appendChild(h('div', { class: 'app' }, side, main));
        return main;
    }

    function route() {
        var v = (location.hash || '#/pipeline').replace('#/', '');
        if (!NAV.some(function (n) { return n[0] === v; })) v = 'pipeline';
        state.view = v;
        refreshStats().then(function () {
            var main = shell();
            ({ pipeline: viewPipeline, assets: viewAssets, profile: viewProfile, search: viewSearch, runs: viewRuns })[v](main);
        }).catch(fail);
    }

    function refreshStats() {
        return api('/stats').then(function (s) { state.stats = s; return s; });
    }

    function pollRun(done) {
        clearInterval(state.pollTimer);
        state.pollTimer = setInterval(function () {
            api('/stats').then(function (s) {
                state.stats = s;
                if (!s.running) { clearInterval(state.pollTimer); done(); }
            }).catch(function () { clearInterval(state.pollTimer); });
        }, 4000);
    }

    function startRun(after) {
        api('/runs/start', { method: 'POST' }).then(function () {
            toast('Search started');
            pollRun(function () { toast('Search finished'); after(); });
        }).catch(fail);
    }

    /* ---------- pipeline ---------- */
    var GROUPS = [
        ['review', 'Ready for review', ['review']],
        ['submitted', 'Submitted', ['submitted']],
        ['closed', 'Interviewed / Lost', ['interview', 'offer', 'lost']],
        ['skipped', 'Skipped', ['skipped']]
    ];
    var LABEL = { review: 'Review', submitted: 'Submitted', interview: 'Interview', offer: 'Offer', lost: 'Lost', skipped: 'Skipped' };
    var PILL = { review: '', submitted: 'amber', interview: 'green', offer: 'green', lost: 'red', skipped: 'gray' };
    var MOVES = {
        review: [['skipped', 'Skip']],
        submitted: [['interview', 'Interviewed'], ['lost', 'Lost / rejected'], ['review', 'Back to review']],
        interview: [['offer', 'Offer'], ['lost', 'Lost'], ['submitted', 'Back to submitted']],
        offer: [['lost', 'Lost'], ['interview', 'Back to interview']],
        lost: [['submitted', 'Back to submitted'], ['interview', 'Back to interview']],
        skipped: [['review', 'Restore to review']]
    };

    function viewPipeline(main) {
        var counts = state.stats.counts;
        var running = state.stats.running;
        var last = state.stats.lastRun;
        var runBtn = h('button', {
            class: 'btn primary', disabled: running,
            onclick: function () { startRun(route); route(); }
        }, running ? 'Searching…' : 'Search now');
        main.appendChild(h('div', { class: 'page-head' },
            h('div', null, h('h1', null, 'Pipeline'),
                h('div', { class: 'sub' }, last ? 'Last search ' + ago(last.startedAt) + ' · ' + last.added + ' added' : 'No searches yet')),
            h('div', { class: 'actions' },
                h('button', { class: 'btn', onclick: addJobModal }, 'Add job'), runBtn)
        ));
        if (running) pollRun(route);

        var tabs = h('div', { class: 'tabs' });
        GROUPS.forEach(function (g) {
            var n = g[2].reduce(function (a, s) { return a + (counts[s] || 0); }, 0);
            tabs.appendChild(h('button', {
                class: state.group === g[0] ? 'active' : '',
                onclick: function () { state.group = g[0]; route(); }
            }, g[1], h('span', { class: 'n' }, n)));
        });
        main.appendChild(tabs);
        var box = h('div', { class: 'list' });
        main.appendChild(box);
        api('/jobs?group=' + state.group).then(function (jobs) {
            if (!jobs.length) {
                box.appendChild(h('div', { class: 'empty' },
                    state.group === 'review' ? 'Nothing waiting. Run a search or add a job manually.' : 'Nothing here yet.'));
                return;
            }
            jobs.forEach(function (j) { box.appendChild(jobCard(j)); });
        }).catch(fail);
    }

    function jobCard(j) {
        return h('div', { class: 'job', onclick: function () { openJob(j._id); } },
            h('div', null,
                h('div', { class: 't' }, j.title),
                h('div', { class: 'c' }, j.company + (j.location ? ' · ' + j.location : '')),
                h('div', { class: 'meta' },
                    h('span', { class: 'pill ' + (PILL[j.status] || '') }, LABEL[j.status] || j.status),
                    j.remote ? h('span', { class: 'pill green' }, 'Remote') : null,
                    h('span', { class: 'pill gray' }, salaryText(j)),
                    h('span', { class: 'pill gray' }, j.source),
                    j.verifyIssues && j.verifyIssues.length ? h('span', { class: 'pill amber' }, 'fact-check adjusted') : null
                )),
            h('div', { class: 'side-r' },
                h('div', { class: 'fit' }, Math.round(j.fit || 0), h('small', null, 'fit')),
                h('span', { class: 'sub' }, ago(j.createdAt))),
            j.reason ? h('div', { class: 'why' }, j.reason) : null
        );
    }

    function addJobModal() {
        var title = txt(''), company = txt(''), url = txt(''), loc = txt(''), desc = area('', 8);
        var btn = h('button', { class: 'btn primary' }, 'Score and generate');
        var m = modal('Add job', h('div', null,
            h('div', { class: 'row' }, field('Title', title), field('Company', company)),
            h('div', { class: 'row' }, field('Posting URL', url), field('Location', loc)),
            field('Job description (paste)', desc),
            h('div', { class: 'actions' }, btn)
        ));
        btn.addEventListener('click', function () {
            btn.disabled = true; btn.textContent = 'Working…';
            api('/jobs/manual', { method: 'POST', body: {
                title: title.value, company: company.value, url: url.value, location: loc.value, description: desc.value
            } }).then(function () { m.close(); toast('Added to review'); route(); })
                .catch(function (e) { btn.disabled = false; btn.textContent = 'Score and generate'; fail(e); });
        });
    }

    /* ---------- overlays ---------- */
    function modal(title, body) {
        var scrim = h('div', { class: 'scrim top', onclick: close });
        var box = h('div', { class: 'modal' },
            h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px' },
                h('h2', { style: 'margin:0;font-size:18px' }, title), h('button', { class: 'x', onclick: close }, '×')),
            body);
        document.body.appendChild(scrim);
        document.body.appendChild(box);
        function close() { scrim.remove(); box.remove(); }
        return { close: close };
    }

    function openJob(id) {
        api('/jobs/' + id).then(function (d) {
            var job = d.job;
            var scrim = h('div', { class: 'scrim', onclick: close });
            var body = h('div', { class: 'body' });
            var tabs = h('div', { class: 'tabs', style: 'margin:14px 0 0;border:0' });
            var bar = h('div', { class: 'bar' });
            var drawer = h('div', { class: 'drawer' },
                h('header', null,
                    h('div', { class: 'top' },
                        h('div', null, h('h2', null, job.title),
                            h('div', { class: 'sub' }, job.company + (job.location ? ' · ' + job.location : '') + ' · ' + salaryText(job))),
                        h('button', { class: 'x', onclick: close }, '×')),
                    tabs),
                body, bar);
            document.body.appendChild(scrim);
            document.body.appendChild(drawer);
            function close() { scrim.remove(); drawer.remove(); }

            var current = 'overview';
            var panes = {
                overview: function () { return paneOverview(job); },
                resume: function () { return paneResume(d); },
                cover: function () { return paneCover(d); },
                site: function () { return paneSite(d, function () { close(); openJob(id); }); },
                history: function () { return paneHistory(job); }
            };
            var names = [['overview', 'Overview'], ['resume', 'Resume'], ['cover', 'Cover letter'], ['site', 'Microsite'], ['history', 'History & notes']];
            function draw() {
                clear(tabs); clear(body);
                names.forEach(function (n) {
                    tabs.appendChild(h('button', { class: current === n[0] ? 'active' : '', onclick: function () { current = n[0]; draw(); } }, n[1]));
                });
                body.appendChild(panes[current]());
            }
            draw();

            if (job.status === 'review') {
                bar.appendChild(h('button', { class: 'btn primary', onclick: function () { submitKit(d, function () { close(); route(); }); } }, 'Submit app'));
            }
            (MOVES[job.status] || []).forEach(function (m) {
                bar.appendChild(h('button', { class: 'btn', onclick: function () { setStatus(job._id, m[0], '', function () { close(); route(); }); } }, m[1]));
            });
            bar.appendChild(h('span', { style: 'flex:1' }));
            bar.appendChild(h('button', { class: 'btn danger', onclick: function () {
                if (confirm('Delete this job and its generated files?')) {
                    api('/jobs/' + job._id, { method: 'DELETE' }).then(function () { close(); route(); }).catch(fail);
                }
            } }, 'Delete'));
        }).catch(fail);
    }

    function setStatus(id, status, note, cb) {
        api('/jobs/' + id + '/status', { method: 'POST', body: { status: status, note: note } })
            .then(function () { toast('Moved to ' + LABEL[status]); cb(); }).catch(fail);
    }

    function paneOverview(job) {
        var wrap = h('div', null);
        if (job.verifyIssues && job.verifyIssues.length) {
            wrap.appendChild(h('div', { class: 'warn' }, 'Fact-check flagged and auto-corrected: ' + job.verifyIssues.join('; ')));
        }
        wrap.appendChild(h('div', { class: 'panel' },
            h('div', { class: 'meta', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px' },
                h('span', { class: 'pill' }, 'Fit ' + Math.round(job.fit || 0)),
                h('span', { class: 'pill gray' }, job.roleFamily || ''),
                job.remote ? h('span', { class: 'pill green' }, 'Remote') : null,
                h('span', { class: 'pill gray' }, job.source)),
            h('div', null, job.reason || ''),
            job.url ? h('p', null, h('a', { href: job.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open posting')) : null));
        [['Requirements', job.requirements], ['Matches', job.matches], ['Gaps', job.gaps]].forEach(function (s) {
            if (!s[1] || !s[1].length) return;
            wrap.appendChild(h('div', { class: 'panel' }, h('h2', null, s[0]),
                h('ul', { class: 'plain' }, s[1].map(function (x) { return h('li', null, x); }))));
        });
        wrap.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Description'),
            h('div', { class: 'desc' }, job.description || ''),
            job.descriptionTruncated ? h('div', { class: 'sub', style: 'margin-top:6px' }, 'Source provides a truncated description; check the full posting before submitting.') : null));
        return wrap;
    }

    function paneResume(d) {
        var a = d.resume;
        if (!a) return h('div', { class: 'empty' }, 'No resume generated.');
        var ed = resumeEditor(a.content, { facts: false });
        return h('div', null,
            ed.el,
            h('div', { class: 'actions' },
                h('button', { class: 'btn primary', onclick: function () {
                    api('/assets/' + a._id, { method: 'PUT', body: { content: ed.get() } }).then(function () { toast('Saved'); }).catch(fail);
                } }, 'Save changes'),
                dl(a._id, 'pdf', 'PDF'), dl(a._id, 'txt', 'Text')));
    }

    function dl(id, fmt, label) {
        return h('a', { class: 'btn', href: '/api/assets/' + id + '/download?format=' + fmt, target: '_blank', rel: 'noopener' }, 'Download ' + label);
    }

    function paneCover(d) {
        var a = d.cover;
        if (!a) return h('div', { class: 'empty' }, 'No cover letter generated.');
        var ta = area(a.text, 16);
        return h('div', null, ta,
            h('div', { class: 'actions', style: 'margin-top:12px' },
                h('button', { class: 'btn primary', onclick: function () {
                    api('/assets/' + a._id, { method: 'PUT', body: { text: ta.value } }).then(function () { toast('Saved'); }).catch(fail);
                } }, 'Save changes'),
                h('button', { class: 'btn', onclick: function () {
                    navigator.clipboard.writeText(ta.value).then(function () { toast('Copied'); }).catch(fail);
                } }, 'Copy'),
                dl(a._id, 'pdf', 'PDF'), dl(a._id, 'txt', 'Text')));
    }

    function paneSite(d, reload) {
        var job = d.job;
        var path = '/s/' + job.siteSlug;
        var full = d.siteUrl;
        return h('div', null,
            h('div', { class: 'note' }, 'Public, unlisted page. Anyone with the link can view it and download the resume PDF.'),
            h('div', { class: 'actions', style: 'margin-bottom:12px' },
                h('a', { class: 'btn', href: path, target: '_blank', rel: 'noopener' }, 'Open'),
                h('button', { class: 'btn', onclick: function () { navigator.clipboard.writeText(full).then(function () { toast('Link copied'); }); } }, 'Copy link'),
                h('button', { class: 'btn', onclick: function (e) {
                    e.target.disabled = true; e.target.textContent = 'Regenerating…';
                    api('/jobs/' + job._id + '/regenerate', { method: 'POST' }).then(function () { toast('Regenerated'); reload(); }).catch(function (x) { fail(x); e.target.disabled = false; });
                } }, 'Regenerate all')),
            h('div', { class: 'sub', style: 'margin-bottom:8px' }, full),
            h('iframe', { src: path, style: 'width:100%;height:520px;border:1px solid var(--line);border-radius:10px;background:#fff' }));
    }

    function paneHistory(job) {
        var notes = area(job.notes, 5);
        return h('div', null,
            h('div', { class: 'panel' }, h('h2', null, 'Notes'), notes,
                h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: function () {
                    api('/jobs/' + job._id, { method: 'PUT', body: { notes: notes.value } }).then(function () { toast('Saved'); }).catch(fail);
                } }, 'Save notes'))),
            h('div', { class: 'panel' }, h('h2', null, 'History'),
                h('ul', { class: 'plain' }, (job.history || []).slice().reverse().map(function (x) {
                    return h('li', null, LABEL[x.status] + ' · ' + new Date(x.at).toLocaleString() + (x.note ? ' · ' + x.note : ''));
                }))));
    }

    function submitKit(d, done) {
        var job = d.job;
        var cover = d.cover;
        var body = h('div', null,
            h('div', { class: 'sub' }, 'Apply with charlie@vannorman.ai. Complete the application on the employer site, then mark it submitted.'),
            h('div', { class: 'steps' },
                h('div', { class: 'step' }, h('div', null, h('b', null, 'Resume'),
                    h('div', { class: 'b' }, d.resume ? [dl(d.resume._id, 'pdf', 'PDF'), dl(d.resume._id, 'txt', 'Text')] : 'Missing'))),
                h('div', { class: 'step' }, h('div', null, h('b', null, 'Cover letter'),
                    h('div', { class: 'b' }, cover ? [
                        h('button', { class: 'btn', onclick: function () { navigator.clipboard.writeText(cover.text).then(function () { toast('Copied'); }); } }, 'Copy text'),
                        dl(cover._id, 'pdf', 'PDF')] : 'Missing'))),
                h('div', { class: 'step' }, h('div', null, h('b', null, 'Microsite link (paste in portfolio/website field)'),
                    h('div', { class: 'b' }, h('button', { class: 'btn', onclick: function () { navigator.clipboard.writeText(d.siteUrl).then(function () { toast('Link copied'); }); } }, 'Copy link')))),
                h('div', { class: 'step' }, h('div', null, h('b', null, 'Open the posting'),
                    h('div', { class: 'b' }, job.url ? h('a', { class: 'btn primary', href: job.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open application') : 'No URL'))),
                h('div', { class: 'step' }, h('div', null, h('b', null, 'After you submit'),
                    h('div', { class: 'b' }, h('button', { class: 'btn primary', onclick: function () {
                        setStatus(job._id, 'submitted', 'submitted manually', function () { m.close(); done(); });
                    } }, 'Mark as submitted'))))
            ));
        var m = modal('Submit: ' + job.company, body);
    }

    /* ---------- resume / profile editor ---------- */
    function resumeEditor(data, opts) {
        data = data || {};
        opts = opts || {};
        var c = data.contact || {};
        var el = h('div', null);
        var headline = txt(data.headline);
        var name = txt(c.name), email = txt(c.email, 'email'), phone = txt(c.phone), loc = txt(c.location);
        var links = area((c.links || []).join('\n'), 2);
        var summary = area(data.summary, 5);
        var skills = area((data.skills || []).join(', '), 3);
        var achievements = area((data.achievements || []).join('\n'), 3);
        var facts = area((data.facts || []).join('\n'), 6);
        var exp = (data.experience || []).map(function (x) { return x; });
        var edu = (data.education || []).map(function (x) { return x; });
        var expBox = h('div'), eduBox = h('div');
        var expState = [], eduState = [];

        function drawExp() {
            clear(expBox); expState = [];
            exp.forEach(function (x, i) {
                var s = { company: txt(x.company), title: txt(x.title), dates: txt(x.dates), location: txt(x.location), bullets: area((x.bullets || []).join('\n'), 5) };
                expState.push(s);
                expBox.appendChild(h('div', { class: 'block' },
                    h('div', { class: 'head' }, h('b', null, (x.title || 'Role') + (x.company ? ' — ' + x.company : '')),
                        h('button', { class: 'btn sm danger', onclick: function () { sync(); exp.splice(i, 1); drawExp(); } }, 'Remove')),
                    h('div', { class: 'row' }, field('Title', s.title), field('Company', s.company)),
                    h('div', { class: 'row' }, field('Dates', s.dates), field('Location', s.location)),
                    field('Bullets (one per line)', s.bullets)));
            });
        }
        function drawEdu() {
            clear(eduBox); eduState = [];
            edu.forEach(function (x, i) {
                var s = { degree: txt(x.degree), school: txt(x.school), dates: txt(x.dates) };
                eduState.push(s);
                eduBox.appendChild(h('div', { class: 'block' },
                    h('div', { class: 'head' }, h('b', null, x.degree || 'Education'),
                        h('button', { class: 'btn sm danger', onclick: function () { sync(); edu.splice(i, 1); drawEdu(); } }, 'Remove')),
                    h('div', { class: 'row' }, field('Degree', s.degree), field('School', s.school), field('Dates', s.dates))));
            });
        }
        function sync() {
            exp = expState.map(function (s) {
                return { company: s.company.value, title: s.title.value, dates: s.dates.value, location: s.location.value, bullets: lines(s.bullets.value) };
            });
            edu = eduState.map(function (s) { return { degree: s.degree.value, school: s.school.value, dates: s.dates.value }; });
        }
        drawExp(); drawEdu();

        if (opts.facts !== false) el.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Canonical truths'),
            h('div', { class: 'sub', style: 'margin-bottom:8px' }, 'Standalone verified facts. Generated material may only use these and the sections below. One per line.'), facts));
        el.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Contact'),
            h('div', { class: 'row' }, field('Name', name), field('Email', email), field('Phone', phone), field('Location', loc)),
            field('Links (one per line)', links)));
        el.appendChild(h('div', { class: 'panel' },
            opts.headline === false ? null : field('Headline', headline),
            field('Summary', summary), field('Skills (comma or line separated)', skills), field('Highlights (one per line)', achievements)));
        el.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Experience'), expBox,
            h('button', { class: 'btn sm', onclick: function () { sync(); exp.push({}); drawExp(); } }, 'Add role')));
        el.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Education'), eduBox,
            h('button', { class: 'btn sm', onclick: function () { sync(); edu.push({}); drawEdu(); } }, 'Add education')));

        return {
            el: el,
            get: function () {
                sync();
                var out = {
                    contact: { name: name.value, email: email.value, phone: phone.value, location: loc.value, links: lines(links.value) },
                    summary: summary.value,
                    skills: list(skills.value),
                    achievements: lines(achievements.value),
                    experience: exp,
                    education: edu
                };
                if (opts.headline !== false) out.headline = headline.value;
                if (opts.facts !== false) out.facts = lines(facts.value);
                return out;
            }
        };
    }

    /* ---------- profile ---------- */
    function viewProfile(main) {
        main.appendChild(h('div', { class: 'page-head' },
            h('div', null, h('h1', null, 'Candidate Profile'),
                h('div', { class: 'sub' }, 'Canonical truths. Every resume, cover letter and microsite is generated from this.'))));
        var holder = h('div');
        main.appendChild(holder);
        api('/profile').then(function (p) { drawProfile(holder, p, null); }).catch(fail);
    }

    function drawProfile(holder, p, conflicts) {
        clear(holder);
        var ed = resumeEditor(p, { facts: true, headline: false });
        var extractBtn = h('button', { class: 'btn', onclick: function () {
            extractBtn.disabled = true; extractBtn.textContent = 'Reading resumes…';
            api('/profile/extract', { method: 'POST' }).then(function (x) {
                toast('Proposal loaded. Review, then save.');
                drawProfile(holder, x, x.conflicts || []);
            }).catch(function (e) { fail(e); extractBtn.disabled = false; extractBtn.textContent = 'Rebuild from uploaded resumes'; });
        } }, 'Rebuild from uploaded resumes');
        holder.appendChild(h('div', { class: 'actions', style: 'margin-bottom:14px' },
            h('button', { class: 'btn primary', onclick: function () {
                api('/profile', { method: 'PUT', body: ed.get() }).then(function () { toast('Profile saved'); }).catch(fail);
            } }, 'Save profile'), extractBtn));
        if (conflicts && conflicts.length) {
            holder.appendChild(h('div', { class: 'warn' }, h('b', null, 'Conflicts between resumes: '), conflicts.join('; ')));
        }
        if (conflicts) holder.appendChild(h('div', { class: 'note' }, 'Unsaved proposal extracted from your resumes. Edit as needed and press Save profile.'));
        holder.appendChild(ed.el);
    }

    /* ---------- assets ---------- */
    function viewAssets(main) {
        main.appendChild(h('div', { class: 'page-head' },
            h('div', null, h('h1', null, 'Assets'), h('div', { class: 'sub' }, 'Uploaded resumes and agent-generated resumes and cover letters.'))));

        var input = h('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, class: 'hidden' });
        var drop = h('div', { class: 'drop', onclick: function () { input.click(); } }, 'Drop resume PDFs here or click to upload');
        function send(files) {
            var fd = new FormData();
            Array.prototype.forEach.call(files, function (f) { fd.append('files', f); });
            if (!files.length) return;
            drop.textContent = 'Uploading…';
            api('/assets/upload', { method: 'POST', body: fd }).then(function (r) {
                var empty = r.filter(function (x) { return x.textEmpty; });
                toast(r.length + ' uploaded' + (empty.length ? '; ' + empty.length + ' has no extractable text (scanned?)' : ''));
                route();
            }).catch(function (e) { fail(e); route(); });
        }
        input.addEventListener('change', function () { send(input.files); });
        drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
        drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
        drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); send(e.dataTransfer.files); });
        main.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Uploaded resumes'), drop, input, h('div', { id: 'up', style: 'margin-top:12px' })));
        main.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Generated resumes'), h('div', { id: 'gr' })));
        main.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Generated cover letters'), h('div', { id: 'cl' })));

        api('/assets').then(function (all) {
            fill('up', all.filter(function (a) { return a.kind === 'resume_upload'; }), true);
            fill('gr', all.filter(function (a) { return a.kind === 'resume_generated'; }), false);
            fill('cl', all.filter(function (a) { return a.kind === 'cover_letter'; }), false);
        }).catch(fail);
    }

    function fill(id, items, deletable) {
        var box = document.getElementById(id);
        if (!box) return;
        if (!items.length) { box.appendChild(h('div', { class: 'sub' }, 'None yet.')); return; }
        var t = h('table', { class: 't' }, h('thead', null, h('tr', null,
            h('th', null, 'Name'), h('th', null, 'Job'), h('th', null, 'Created'), h('th', null, ''))));
        var tb = h('tbody');
        items.forEach(function (a) {
            tb.appendChild(h('tr', null,
                h('td', null, a.label),
                h('td', null, a.job ? h('a', { href: '#', onclick: function (e) { e.preventDefault(); openJob(a.jobId); } }, a.job.company + ' — ' + a.job.title) : (a.kind === 'resume_upload' ? 'Source' : '')),
                h('td', null, ago(a.createdAt)),
                h('td', { style: 'text-align:right;white-space:nowrap' },
                    h('a', { class: 'btn sm', href: '/api/assets/' + a._id + '/download', target: '_blank', rel: 'noopener' }, 'PDF'), ' ',
                    deletable ? h('button', { class: 'btn sm danger', onclick: function () {
                        if (confirm('Delete this resume?')) api('/assets/' + a._id, { method: 'DELETE' }).then(route).catch(fail);
                    } }, 'Delete') : null)));
        });
        t.appendChild(tb);
        box.appendChild(t);
    }

    /* ---------- search settings ---------- */
    function viewSearch(main) {
        main.appendChild(h('div', { class: 'page-head' },
            h('div', null, h('h1', null, 'Search Settings'), h('div', { class: 'sub' }, 'Criteria for the daily search.'))));
        var holder = h('div');
        main.appendChild(holder);
        api('/settings').then(function (s) {
            var roles = area(s.roles.join('\n'), 10);
            var minSalary = txt(s.minSalary, 'number');
            var unlisted = h('input', { type: 'checkbox', checked: s.includeUnlistedSalary });
            var remote = h('input', { type: 'checkbox', checked: s.allowRemote });
            var reloc = h('input', { type: 'checkbox', checked: s.allowRelocation });
            var metros = area(s.onsiteMetros.join('\n'), 3);
            var relocNote = txt(s.relocationNote);
            var minFit = txt(s.minFitScore, 'number');
            var maxNew = txt(s.maxNewPerRun, 'number');
            var maxAge = txt(s.maxDaysOld, 'number');
            var gh = area((s.boards.greenhouse || []).join('\n'), 4);
            var lv = area((s.boards.lever || []).join('\n'), 4);
            var ab = area((s.boards.ashby || []).join('\n'), 4);
            var sAdz = h('input', { type: 'checkbox', checked: s.sources.adzuna });
            var sJs = h('input', { type: 'checkbox', checked: s.sources.jsearch });
            var sBd = h('input', { type: 'checkbox', checked: s.sources.boards });
            function cred(ok, label) { return h('span', { class: 'pill ' + (ok ? 'green' : 'red') }, label + (ok ? ' configured' : ' missing')); }
            holder.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Credentials (.env)'),
                h('div', { class: 'actions' }, cred(s.credentials.anthropic, 'Anthropic'), cred(s.credentials.adzuna, 'Adzuna'), cred(s.credentials.jsearch, 'JSearch'))));
            holder.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Roles'), field('Target roles (one per line)', roles)));
            holder.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Filters'),
                h('div', { class: 'row' }, field('Minimum base salary (USD)', minSalary), field('Minimum fit score (0–100)', minFit),
                    field('Max new per run', maxNew), field('Max posting age (days)', maxAge)),
                h('label', { class: 'chk' }, unlisted, 'Include postings with no listed salary (estimated)'),
                h('label', { class: 'chk' }, remote, 'Remote (US)'),
                h('label', { class: 'chk' }, reloc, 'Relocation acceptable'),
                field('Relocation note', relocNote),
                field('Preferred onsite/hybrid metros (one per line)', metros)));
            holder.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Sources'),
                h('label', { class: 'chk' }, sAdz, 'Adzuna API'),
                h('label', { class: 'chk' }, sJs, 'JSearch API (RapidAPI)'),
                h('label', { class: 'chk' }, sBd, 'Company ATS boards'),
                h('div', { class: 'row' },
                    field('Greenhouse board tokens', gh), field('Lever company slugs', lv), field('Ashby board names', ab))));
            holder.appendChild(h('button', { class: 'btn primary', onclick: function () {
                api('/settings', { method: 'PUT', body: {
                    roles: lines(roles.value), minSalary: Number(minSalary.value) || 0,
                    includeUnlistedSalary: unlisted.checked, allowRemote: remote.checked, allowRelocation: reloc.checked,
                    relocationNote: relocNote.value, onsiteMetros: lines(metros.value),
                    minFitScore: Number(minFit.value) || 0, maxNewPerRun: Number(maxNew.value) || 10, maxDaysOld: Number(maxAge.value) || 3,
                    boards: { greenhouse: lines(gh.value), lever: lines(lv.value), ashby: lines(ab.value) },
                    sources: { adzuna: sAdz.checked, jsearch: sJs.checked, boards: sBd.checked }
                } }).then(function () { toast('Settings saved'); }).catch(fail);
            } }, 'Save settings'));
        }).catch(fail);
    }

    /* ---------- runs ---------- */
    function viewRuns(main) {
        var running = state.stats.running;
        main.appendChild(h('div', { class: 'page-head' },
            h('div', null, h('h1', null, 'Runs'), h('div', { class: 'sub' }, 'Daily search history and logs.')),
            h('button', { class: 'btn primary', disabled: running, onclick: function () { startRun(route); route(); } }, running ? 'Searching…' : 'Search now')));
        if (running) pollRun(route);
        var box = h('div');
        main.appendChild(box);
        api('/runs').then(function (runs) {
            if (!runs.length) { box.appendChild(h('div', { class: 'empty' }, 'No runs yet.')); return; }
            runs.forEach(function (r) {
                var log = h('pre', { class: 'log hidden' }, (r.log || []).join('\n'));
                box.appendChild(h('div', { class: 'panel' },
                    h('div', { style: 'display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center' },
                        h('div', null, h('b', null, new Date(r.startedAt).toLocaleString()), ' ',
                            h('span', { class: 'pill ' + (r.status === 'done' ? 'green' : r.status === 'error' ? 'red' : 'amber') }, r.status),
                            ' ', h('span', { class: 'pill gray' }, r.trigger)),
                        h('div', { class: 'sub' }, 'fetched ' + r.fetched + ' · scored ' + r.scored + ' · added ' + r.added)),
                    h('button', { class: 'btn sm', style: 'margin-top:8px', onclick: function () { log.classList.toggle('hidden'); } }, 'Log'),
                    log));
            });
        }).catch(fail);
    }

    /* ---------- boot ---------- */
    var hooked = false;
    function boot() {
        api('/auth').then(function (a) {
            if (!a.authed) return showLogin();
            if (!hooked) { window.addEventListener('hashchange', route); hooked = true; }
            route();
        }).catch(showLogin);
    }
    boot();
})();
