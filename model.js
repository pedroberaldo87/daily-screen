// New data model: template → phase → series. Each concrete "box"/run is a
// distinct `series` row (its own id = the unique code), holding the daily_tasks
// and its own status. Templates and phases are the (editable) definition;
// series are immutable snapshots so editing the definition never rewrites the
// past. See .claude/plans/magical-waddling-wand.md for the full design.

// ── Date helpers (UTC, avoid DST drift) ──
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('simple','count','protocol')),
      repeat_indefinitely INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      followup_title TEXT,
      followup_category TEXT,
      followup_icon TEXT,
      followup_recreate INTEGER DEFAULT 0,
      recreate_template_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS phases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      phase_order INTEGER DEFAULT 0,
      title TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('medication','supplement','reminder')),
      icon TEXT DEFAULT '✅',
      weekdays TEXT DEFAULT '[0,1,2,3,4,5,6]',
      periods TEXT DEFAULT '[]',
      total_count INTEGER,
      duration_days INTEGER,
      alert_penultimate TEXT,
      alert_last TEXT
    );

    CREATE TABLE IF NOT EXISTS series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      phase_id INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
      seq INTEGER DEFAULT 1,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      icon TEXT DEFAULT '✅',
      sort_order INTEGER DEFAULT 0,
      weekdays TEXT DEFAULT '[0,1,2,3,4,5,6]',
      periods TEXT DEFAULT '[]',
      total_count INTEGER,
      completed_count INTEGER DEFAULT 0,
      alert_penultimate TEXT,
      alert_last TEXT,
      start_date TEXT,
      end_date TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','completed')),
      completed_at TEXT,
      source_series_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS daily_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      completed_at TEXT,
      UNIQUE(series_id, date)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_tasks_date ON daily_tasks(date);
    CREATE INDEX IF NOT EXISTS idx_series_template ON series(template_id);
  `);
}

function createModel(db) {
  initSchema(db);

  // ── Series creation: snapshot the phase into an immutable series row ──
  function spawnSeries(templateId, phase, { seq = 1, start_date = null, end_date = null, source_series_id = null } = {}) {
    const result = db.prepare(`
      INSERT INTO series (
        template_id, phase_id, seq, title, category, icon, sort_order,
        weekdays, periods, total_count, alert_penultimate, alert_last,
        start_date, end_date, status, source_series_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      templateId, phase.id, seq, phase.title, phase.category, phase.icon || '✅',
      phase.sort_order ?? phase.phase_order ?? 0, phase.weekdays || '[0,1,2,3,4,5,6]', phase.periods || '[]',
      phase.total_count ?? null, phase.alert_penultimate ?? null, phase.alert_last ?? null,
      start_date, end_date, source_series_id,
    );
    return result.lastInsertRowid;
  }

  // ── Create a standalone item (simple or count) ──
  function createItem(data) {
    const kind = data.total_count ? 'count' : 'simple';
    const tx = db.transaction(() => {
      const tmplId = db.prepare(`
        INSERT INTO templates (name, kind, repeat_indefinitely, sort_order,
          followup_title, followup_category, followup_icon, followup_recreate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.title, kind, kind === 'count' ? 1 : 0, data.sort_order || 0,
        data.followup_title || null, data.followup_category || null,
        data.followup_icon || null, data.followup_recreate ? 1 : 0,
      ).lastInsertRowid;

      const phaseId = db.prepare(`
        INSERT INTO phases (template_id, phase_order, title, category, icon,
          weekdays, periods, total_count, alert_penultimate, alert_last)
        VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tmplId, data.title, data.category, data.icon || '✅',
        data.weekdays || '[0,1,2,3,4,5,6]', data.periods || '[]',
        data.total_count || null, data.alert_penultimate || null, data.alert_last || null,
      ).lastInsertRowid;

      const phase = db.prepare('SELECT * FROM phases WHERE id = ?').get(phaseId);
      phase.sort_order = data.sort_order || 0;
      spawnSeries(tmplId, phase, { seq: 1, start_date: data.start_date || null, end_date: null });
      return tmplId;
    });
    return tx();
  }

  // ── Protocol: template(protocol) + N phases + N dated series in sequence ──
  function computePhaseDates(startDate, phases, repeat) {
    let cursor = startDate;
    return phases.map((p, i) => {
      const isLast = i === phases.length - 1;
      const dur = Number(p.duration_days) || 1;
      const start = cursor;
      const end = isLast && repeat ? null : addDays(start, dur - 1);
      cursor = addDays(start, dur);
      return { ...p, start_date: start, end_date: end };
    });
  }

  function createProtocol(data) {
    const repeat = !!data.repeat_indefinitely;
    const tx = db.transaction(() => {
      const tmplId = db.prepare(`
        INSERT INTO templates (name, kind, repeat_indefinitely, sort_order,
          followup_title, followup_category, followup_icon, followup_recreate)
        VALUES (?, 'protocol', ?, ?, ?, ?, ?, ?)
      `).run(
        data.name, repeat ? 1 : 0, data.sort_order || 0,
        data.followup_title || null, data.followup_category || null,
        data.followup_icon || null, data.followup_recreate ? 1 : 0,
      ).lastInsertRowid;

      const withDates = computePhaseDates(data.start_date, data.phases, repeat);
      withDates.forEach((p, i) => {
        const phaseId = db.prepare(`
          INSERT INTO phases (template_id, phase_order, title, category, icon,
            weekdays, periods, total_count, duration_days, alert_penultimate, alert_last)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          tmplId, i, p.title, p.category, p.icon || '💊',
          typeof p.weekdays === 'string' ? p.weekdays : JSON.stringify(p.weekdays || [0, 1, 2, 3, 4, 5, 6]),
          typeof p.periods === 'string' ? p.periods : JSON.stringify(p.periods || []),
          p.total_count || null, Number(p.duration_days) || null,
          p.alert_penultimate || null, p.alert_last || null,
        ).lastInsertRowid;
        const phase = db.prepare('SELECT * FROM phases WHERE id = ?').get(phaseId);
        spawnSeries(tmplId, phase, { seq: 1, start_date: p.start_date, end_date: p.end_date });
      });
      return tmplId;
    });
    return tx();
  }

  // ── Time-based conclusion: protocol phases whose window has passed ──
  function concludeElapsedPhases(today) {
    const elapsed = db.prepare(`
      SELECT s.* FROM series s JOIN templates t ON t.id = s.template_id
      WHERE t.kind = 'protocol' AND s.status = 'active'
        AND s.end_date IS NOT NULL AND s.end_date < ?
    `).all(today);
    const affected = new Set();
    db.transaction(() => {
      for (const s of elapsed) {
        db.prepare("UPDATE series SET status = 'completed', completed_at = ? WHERE id = ?").run(nowIso(), s.id);
        affected.add(s.template_id);
      }
    })();
    for (const tmplId of affected) {
      const tmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(tmplId);
      if (!tmpl.followup_title || tmpl.repeat_indefinitely) continue;
      const stillActive = db.prepare("SELECT 1 FROM series WHERE template_id = ? AND status = 'active' LIMIT 1").get(tmplId);
      if (stillActive) continue; // protocolo ainda em andamento
      const lastSerie = db.prepare('SELECT * FROM series WHERE template_id = ? ORDER BY sort_order DESC LIMIT 1').get(tmplId);
      if (lastSerie) spawnFollowup(lastSerie);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // CICLO DA CARTELA (count) — máquina de estados
  //
  // Uma cartela é uma `series` count. Estados e transições (tudo passa por
  // reconcileCountCycle, o ÚNICO ponto que muda o status de uma cartela):
  //
  //   active ──(doses marcadas atingem total_count)──▶ completed (+ spawn "Comprar")
  //   completed ──(desmarca abaixo do total)──▶ active (+ desfaz "Comprar" vazio)
  //
  // Invariantes garantidos aqui (antes estavam espalhados e se contradiziam):
  //   • TETO só na MARCAÇÃO: toggleTask recusa marcar além de total_count. A
  //     geração é livre — contar dias gerados travava a cartela no dia pulado.
  //   • No máximo 1 cartela ATIVA por template count (ou ela, ou o "Comprar").
  //   • 1 template de follow-up por origem, reusado entre ciclos (sem duplicar
  //     "Comprar X"); no máx. 1 follow-up pendente por cartela.
  // ════════════════════════════════════════════════════════════════════════

  // Contador derivado: completed_count = daily_tasks marcadas da cartela.
  function recountSeries(seriesId) {
    const n = db.prepare('SELECT COUNT(*) c FROM daily_tasks WHERE series_id = ? AND completed = 1').get(seriesId).c;
    db.prepare('UPDATE series SET completed_count = ? WHERE id = ?').run(n, seriesId);
    return n;
  }

  // Cria a tarefa "Comprar X" quando a cartela fecha. Idempotente: 1 follow-up
  // pendente por cartela, 1 template de follow-up por origem (reusado).
  function spawnFollowup(serie) {
    const tmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(serie.template_id);
    if (!tmpl || !tmpl.followup_title) return;

    // Já existe um follow-up pendente desta cartela? não duplica.
    const existing = db.prepare(
      "SELECT 1 FROM series WHERE source_series_id = ? AND status = 'active' LIMIT 1"
    ).get(serie.id);
    if (existing) return;

    // Reusa o template de follow-up da origem; só cria na primeira vez.
    let fTmpl = db.prepare('SELECT * FROM templates WHERE recreate_template_id = ?').get(tmpl.id);
    if (!fTmpl) {
      const fId = db.prepare(`
        INSERT INTO templates (name, kind, repeat_indefinitely, sort_order, recreate_template_id)
        VALUES (?, 'count', 0, ?, ?)
      `).run(tmpl.followup_title, serie.sort_order, tmpl.id).lastInsertRowid;
      db.prepare(`
        INSERT INTO phases (template_id, phase_order, title, category, icon, total_count)
        VALUES (?, 0, ?, ?, ?, 1)
      `).run(fId, tmpl.followup_title, tmpl.followup_category || 'reminder', tmpl.followup_icon || '📌');
      fTmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(fId);
    }
    const fPhase = db.prepare('SELECT * FROM phases WHERE template_id = ? ORDER BY phase_order LIMIT 1').get(fTmpl.id);
    const nextSeq = (db.prepare('SELECT MAX(seq) m FROM series WHERE template_id = ?').get(fTmpl.id).m || 0) + 1;
    spawnSeries(fTmpl.id, fPhase, { seq: nextSeq, source_series_id: serie.id });
  }

  // A máquina de estados. Chamada após cada recount (toggle/edição). Reversível.
  function reconcileCountCycle(seriesId) {
    const serie = db.prepare('SELECT * FROM series WHERE id = ?').get(seriesId);
    if (!serie || serie.total_count == null) return;
    const reached = serie.completed_count >= serie.total_count;

    if (reached && serie.status === 'active') {
      // Fecha a cartela. Apaga daily_tasks que sobraram DESMARCADAS: ao atingir
      // o total, elas são excedentes (dia gerado durante uma reabertura, ou dia
      // pulado) e apareceriam como tarefa "N/N" clicável morta. Sem isso, o
      // ciclo desmarcar→remarcar deixava órfã na tela.
      db.prepare('DELETE FROM daily_tasks WHERE series_id = ? AND completed = 0').run(seriesId);
      db.prepare("UPDATE series SET status = 'completed', completed_at = ? WHERE id = ?").run(nowIso(), seriesId);
      spawnFollowup(serie);
    } else if (!reached && serie.status === 'completed') {
      // Reabriu (desmarcou): volta a ativa e desfaz o "Comprar" pendente vazio.
      db.prepare("UPDATE series SET status = 'active', completed_at = NULL WHERE id = ?").run(seriesId);
      const pending = db.prepare(
        "SELECT id FROM series WHERE source_series_id = ? AND status = 'active' AND completed_count = 0"
      ).all(seriesId);
      for (const p of pending) db.prepare('DELETE FROM series WHERE id = ?').run(p.id);
    }
  }

  // ── Lazy generation: one daily_task per active series in its window ──
  function generateDailyTasks(date) {
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const seriesList = db.prepare("SELECT * FROM series WHERE status = 'active'").all();
    const insert = db.prepare('INSERT OR IGNORE INTO daily_tasks (series_id, date) VALUES (?, ?)');
    const tx = db.transaction(() => {
      for (const s of seriesList) {
        if (s.start_date && date < s.start_date) continue;
        if (s.end_date && date > s.end_date) continue;
        const weekdays = JSON.parse(s.weekdays || '[0,1,2,3,4,5,6]');
        if (!weekdays.includes(dayOfWeek)) continue;
        // No ceiling here: an active count box still needs daily_tasks until its
        // doses are all marked, even across skipped days. The ceiling lives in
        // toggleTask (refuse marking beyond total_count) — counting generated
        // days here would freeze a box whenever a dose day was skipped.
        insert.run(s.id, date);
      }
    });
    tx();
  }

  // ── Map a joined daily_task+series+template row to the frozen task shape ──
  function mapTaskRow(r, date) {
    let alert = null;
    const isProto = r.tkind === 'protocol';
    if (isProto && r.end_date) {
      const daysLeft = dayCount(date, r.end_date) - 1;
      if (daysLeft === 0 && r.alert_last) alert = { type: 'last', message: r.alert_last };
      else if (daysLeft === 1 && r.alert_penultimate) alert = { type: 'penultimate', message: r.alert_penultimate };
    } else if (r.total_count) {
      const remaining = r.total_count - r.completed_count;
      if (remaining === 1 && r.alert_last) alert = { type: 'last', message: r.alert_last };
      else if (remaining === 2 && r.alert_penultimate) alert = { type: 'penultimate', message: r.alert_penultimate };
    }
    return {
      id: r.id,
      routine_item_id: r.series_id, // back-compat alias
      series_id: r.series_id,
      date: r.date,
      completed: r.completed,
      completed_at: r.completed_at,
      title: r.title,
      category: r.category,
      icon: r.icon,
      sort_order: r.sort_order,
      periods: r.periods,
      total_count: r.total_count,
      completed_count: r.completed_count,
      alert_penultimate: r.alert_penultimate,
      alert_last: r.alert_last,
      protocol_id: isProto ? r.template_id : null,
      phase_order: isProto ? r.sort_order : null,
      alert,
    };
  }

  const TASK_SELECT = `
    SELECT dt.id, dt.series_id, dt.date, dt.completed, dt.completed_at,
      s.title, s.category, s.icon, s.sort_order, s.periods, s.total_count, s.completed_count,
      s.alert_penultimate, s.alert_last, s.end_date, s.template_id, t.kind AS tkind
    FROM daily_tasks dt
    JOIN series s ON s.id = dt.series_id
    JOIN templates t ON t.id = s.template_id`;

  function getTasksView(date) {
    const rows = db.prepare(`${TASK_SELECT} WHERE dt.date = ? AND t.active = 1 ORDER BY s.sort_order, s.id`).all(date);
    return rows.map((r) => mapTaskRow(r, date));
  }

  // ── Toggle a daily_task, recount + reconcile its series, return task shape ──
  function toggleTask(id) {
    const task = db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(id);
    if (!task) return null;
    const newCompleted = task.completed ? 0 : 1;

    // Ceiling (defense in depth): refuse to MARK a count series already at its
    // total. Unmarking is always allowed. Guards against legacy excess tasks.
    if (newCompleted) {
      const serie = db.prepare('SELECT * FROM series WHERE id = ?').get(task.series_id);
      if (serie && serie.total_count != null && serie.completed_count >= serie.total_count) {
        const row = db.prepare(`${TASK_SELECT} WHERE dt.id = ?`).get(id);
        return mapTaskRow(row, row.date);
      }
    }
    const completedAt = newCompleted ? nowIso() : null;

    db.transaction(() => {
      db.prepare('UPDATE daily_tasks SET completed = ?, completed_at = ? WHERE id = ?')
        .run(newCompleted, completedAt, id);
      recountSeries(task.series_id);
      reconcileCountCycle(task.series_id);
    })();

    const row = db.prepare(`${TASK_SELECT} WHERE dt.id = ?`).get(id);
    const result = mapTaskRow(row, row.date);

    // Offer the recreate prompt when completing a follow-up whose origin opted in.
    if (newCompleted) {
      const serie = db.prepare('SELECT * FROM series WHERE id = ?').get(task.series_id);
      const tmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(serie.template_id);
      if (tmpl && tmpl.recreate_template_id) {
        const orig = db.prepare('SELECT * FROM templates WHERE id = ?').get(tmpl.recreate_template_id);
        const origPhase = orig && db.prepare('SELECT * FROM phases WHERE template_id = ? ORDER BY phase_order LIMIT 1').get(orig.id);
        if (orig && orig.followup_recreate && origPhase) {
          result.recreate_prompt = {
            type: orig.kind === 'protocol' ? 'protocol' : 'item',
            title: orig.kind === 'protocol' ? orig.name : origPhase.title,
            icon: origPhase.icon || result.icon,
          };
        }
      }
    }
    return result;
  }

  // ── Admin "item" view: template(simple|count) + phase + current series ──
  function currentSeries(templateId) {
    return db.prepare(
      "SELECT * FROM series WHERE template_id = ? ORDER BY (status='active') DESC, seq DESC LIMIT 1"
    ).get(templateId);
  }
  function phase0(templateId) {
    return db.prepare('SELECT * FROM phases WHERE template_id = ? ORDER BY phase_order LIMIT 1').get(templateId);
  }
  function itemShape(t) {
    const phase = phase0(t.id);
    const cur = currentSeries(t.id);
    return {
      id: t.id,
      title: phase.title,
      category: phase.category,
      icon: phase.icon,
      sort_order: t.sort_order,
      active: t.active,
      weekdays: phase.weekdays,
      periods: phase.periods,
      total_count: phase.total_count,
      completed_count: cur ? cur.completed_count : 0,
      alert_penultimate: phase.alert_penultimate,
      alert_last: phase.alert_last,
      followup_title: t.followup_title,
      followup_category: t.followup_category,
      followup_icon: t.followup_icon,
      followup_recreate: t.followup_recreate,
      start_date: cur ? cur.start_date : null,
      end_date: cur ? cur.end_date : null,
      created_at: t.created_at,
      protocol_id: null,
    };
  }
  function getItemsView() {
    const tmpls = db.prepare(
      "SELECT * FROM templates WHERE kind IN ('simple','count') ORDER BY active DESC, sort_order, id"
    ).all();
    return tmpls.map(itemShape);
  }

  // ── Admin "protocol" view: template(protocol) + phases (with current series) ──
  function protocolShape(t) {
    const phases = db.prepare('SELECT * FROM phases WHERE template_id = ? ORDER BY phase_order').all(t.id);
    const phasesShaped = phases.map((ph) => {
      const s = db.prepare('SELECT * FROM series WHERE phase_id = ? ORDER BY seq DESC LIMIT 1').get(ph.id);
      return {
        id: ph.id,
        title: ph.title,
        category: ph.category,
        icon: ph.icon,
        sort_order: ph.phase_order,
        active: 1,
        weekdays: ph.weekdays,
        periods: ph.periods,
        total_count: ph.total_count,
        completed_count: s ? s.completed_count : 0,
        alert_penultimate: ph.alert_penultimate,
        alert_last: ph.alert_last,
        protocol_id: t.id,
        phase_order: ph.phase_order,
        start_date: s ? s.start_date : null,
        end_date: s ? s.end_date : null,
        created_at: t.created_at,
        duration_days: ph.duration_days,
      };
    });
    const firstStart = db.prepare('SELECT MIN(start_date) m FROM series WHERE template_id = ?').get(t.id).m;
    return {
      id: t.id,
      name: t.name,
      start_date: firstStart,
      repeat_indefinitely: t.repeat_indefinitely,
      active: t.active,
      created_at: t.created_at,
      alert_penultimate: null,
      alert_last: null,
      followup_title: t.followup_title,
      followup_category: t.followup_category,
      followup_icon: t.followup_icon,
      followup_recreate: t.followup_recreate,
      phases: phasesShaped,
    };
  }
  function getProtocolsView() {
    const tmpls = db.prepare("SELECT * FROM templates WHERE kind = 'protocol' AND active = 1 ORDER BY created_at DESC").all();
    return tmpls.map(protocolShape);
  }
  function getProtocolView(id) {
    const t = db.prepare("SELECT * FROM templates WHERE id = ? AND kind = 'protocol'").get(id);
    return t ? protocolShape(t) : null;
  }

  // ── Concluídos: completed series (boxes + protocol phases), newest first ──
  function getCompletedView() {
    const rows = db.prepare(`
      SELECT s.*, t.name AS template_name, t.kind AS kind
      FROM series s JOIN templates t ON t.id = s.template_id
      WHERE s.status = 'completed'
      ORDER BY s.completed_at DESC, s.id DESC
    `).all();
    return rows.map((s) => ({
      id: s.id,
      template_id: s.template_id,
      template_name: s.template_name,
      kind: s.kind,
      title: s.title,
      category: s.category,
      icon: s.icon,
      seq: s.seq,
      total_count: s.total_count,
      completed_count: s.completed_count,
      start_date: s.start_date,
      end_date: s.end_date,
      completed_at: s.completed_at,
    }));
  }

  // ── Admin write CRUD (operate on templates/phases, reflect on active series) ──
  function reflectOnActiveSeries(templateId, fields) {
    const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE series SET ${sets} WHERE template_id = @tid AND status = 'active'`).run({ ...fields, tid: templateId });
  }

  function updateItem(id, data) {
    const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
    if (!t || t.kind === 'protocol') return null;
    const phase = phase0(id);
    const pick = (v, fallback) => (v === undefined ? fallback : v);
    const next = {
      title: pick(data.title, phase.title),
      category: pick(data.category, phase.category),
      icon: pick(data.icon, phase.icon),
      weekdays: pick(data.weekdays, phase.weekdays),
      periods: pick(data.periods, phase.periods),
      total_count: data.total_count !== undefined ? (data.total_count || null) : phase.total_count,
      alert_penultimate: data.alert_penultimate !== undefined ? (data.alert_penultimate || null) : phase.alert_penultimate,
      alert_last: data.alert_last !== undefined ? (data.alert_last || null) : phase.alert_last,
    };
    const kind = next.total_count ? 'count' : 'simple';
    db.transaction(() => {
      db.prepare(`UPDATE templates SET name=?, kind=?, repeat_indefinitely=?, sort_order=?, active=?,
        followup_title=?, followup_category=?, followup_icon=?, followup_recreate=? WHERE id=?`).run(
        next.title, kind, kind === 'count' ? 1 : 0,
        pick(data.sort_order, t.sort_order),
        data.active !== undefined ? (data.active ? 1 : 0) : t.active,
        data.followup_title !== undefined ? (data.followup_title || null) : t.followup_title,
        data.followup_category !== undefined ? (data.followup_category || null) : t.followup_category,
        data.followup_icon !== undefined ? (data.followup_icon || null) : t.followup_icon,
        data.followup_recreate !== undefined ? (data.followup_recreate ? 1 : 0) : t.followup_recreate,
        id,
      );
      db.prepare(`UPDATE phases SET title=?, category=?, icon=?, weekdays=?, periods=?, total_count=?,
        alert_penultimate=?, alert_last=? WHERE id=?`).run(
        next.title, next.category, next.icon, next.weekdays, next.periods, next.total_count,
        next.alert_penultimate, next.alert_last, phase.id,
      );
      reflectOnActiveSeries(id, {
        title: next.title, category: next.category, icon: next.icon,
        sort_order: pick(data.sort_order, t.sort_order),
        weekdays: next.weekdays, periods: next.periods, total_count: next.total_count,
        alert_penultimate: next.alert_penultimate, alert_last: next.alert_last,
      });
      const norm = (v) => (v === '' || v === null ? null : v);
      if (data.start_date !== undefined) db.prepare("UPDATE series SET start_date=? WHERE template_id=? AND status='active'").run(norm(data.start_date), id);
      if (data.end_date !== undefined) db.prepare("UPDATE series SET end_date=? WHERE template_id=? AND status='active'").run(norm(data.end_date), id);
      for (const s of db.prepare("SELECT id FROM series WHERE template_id=? AND status='active'").all(id)) {
        recountSeries(s.id);
        reconcileCountCycle(s.id);
      }
    })();
    return itemShape(db.prepare('SELECT * FROM templates WHERE id = ?').get(id));
  }

  function deactivateItem(id) {
    db.prepare('UPDATE templates SET active = 0 WHERE id = ?').run(id);
  }

  // Remove without losing completed history: archive (deactivate) if any
  // completed daily_tasks exist, else hard-delete (cascade phases/series/tasks).
  function deleteItemPermanently(id) {
    const hasHistory = db.prepare(`
      SELECT 1 FROM daily_tasks dt JOIN series s ON s.id = dt.series_id
      WHERE s.template_id = ? AND dt.completed = 1 LIMIT 1
    `).get(id);
    if (hasHistory) db.prepare('UPDATE templates SET active = 0 WHERE id = ?').run(id);
    else db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  }

  function deleteProtocol(id) {
    deleteItemPermanently(id);
  }

  // Update strategy for protocols: archive current active phases/series (keep
  // completed history), then recreate from the new phase list. Mirrors the old
  // delete-and-recreate but never wipes completed series (snapshots survive).
  function updateProtocol(id, data) {
    const t = db.prepare("SELECT * FROM templates WHERE id = ? AND kind = 'protocol'").get(id);
    if (!t) return null;
    db.transaction(() => {
      db.prepare(`UPDATE templates SET name=?, repeat_indefinitely=?, active=?,
        followup_title=?, followup_category=?, followup_icon=?, followup_recreate=? WHERE id=?`).run(
        data.name ?? t.name,
        data.repeat_indefinitely !== undefined ? (data.repeat_indefinitely ? 1 : 0) : t.repeat_indefinitely,
        data.active !== undefined ? (data.active ? 1 : 0) : t.active,
        data.followup_title !== undefined ? (data.followup_title || null) : t.followup_title,
        data.followup_category !== undefined ? (data.followup_category || null) : t.followup_category,
        data.followup_icon !== undefined ? (data.followup_icon || null) : t.followup_icon,
        data.followup_recreate !== undefined ? (data.followup_recreate ? 1 : 0) : t.followup_recreate,
        id,
      );
      if (Array.isArray(data.phases)) {
        // Drop active (non-completed) series + their phases; keep completed ones.
        const activeSeries = db.prepare("SELECT id, phase_id FROM series WHERE template_id = ? AND status = 'active'").all(id);
        for (const s of activeSeries) db.prepare('DELETE FROM series WHERE id = ?').run(s.id);
        // Remove phases that no longer back any series.
        db.prepare(`DELETE FROM phases WHERE template_id = ? AND id NOT IN (SELECT DISTINCT phase_id FROM series WHERE template_id = ?)`).run(id, id);
        // Recreate phases + dated series from the new list.
        const start = data.start_date ?? t.created_at.slice(0, 10);
        const repeat = data.repeat_indefinitely !== undefined ? !!data.repeat_indefinitely : !!t.repeat_indefinitely;
        const withDates = computePhaseDates(start, data.phases, repeat);
        withDates.forEach((p, i) => {
          const phaseId = db.prepare(`INSERT INTO phases (template_id, phase_order, title, category, icon,
            weekdays, periods, total_count, duration_days, alert_penultimate, alert_last)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            id, i, p.title, p.category, p.icon || '💊',
            typeof p.weekdays === 'string' ? p.weekdays : JSON.stringify(p.weekdays || [0, 1, 2, 3, 4, 5, 6]),
            typeof p.periods === 'string' ? p.periods : JSON.stringify(p.periods || []),
            p.total_count || null, Number(p.duration_days) || null,
            p.alert_penultimate || null, p.alert_last || null,
          ).lastInsertRowid;
          const phase = db.prepare('SELECT * FROM phases WHERE id = ?').get(phaseId);
          spawnSeries(id, phase, { seq: 1, start_date: p.start_date, end_date: p.end_date });
        });
      }
    })();
    return getProtocolView(id);
  }

  // Convert a simple/count item into a protocol: existing phase becomes phase 0,
  // a blank phase 1 is added, and the current active series is re-windowed.
  function convertItemToProtocol(id, opts = {}) {
    const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
    if (!t) return null;
    if (t.kind === 'protocol') {
      const err = new Error('Item is already a protocol phase');
      err.code = 'ALREADY_PHASE';
      throw err;
    }
    const today = opts.today || new Date().toISOString().slice(0, 10);
    const firstDur = Math.max(1, Math.min(3650, Number(opts.first_phase_duration) || 7));
    const secondDur = Math.max(1, Math.min(3650, Number(opts.second_phase_duration) || 7));
    const repeat = !!opts.repeat_indefinitely;
    const phase = phase0(id);

    db.transaction(() => {
      db.prepare("UPDATE templates SET kind = 'protocol', name = ?, repeat_indefinitely = ? WHERE id = ?")
        .run(opts.name && opts.name.trim() ? opts.name : phase.title, repeat ? 1 : 0, id);
      // Phase 0 keeps its id + history; set its duration window.
      const firstEnd = addDays(today, firstDur - 1);
      db.prepare('UPDATE phases SET phase_order = 0, duration_days = ? WHERE id = ?').run(firstDur, phase.id);
      db.prepare("UPDATE series SET start_date = ?, end_date = ? WHERE template_id = ? AND status = 'active'")
        .run(today, firstEnd, id);
      // Phase 1: blank clone.
      const secondStart = addDays(today, firstDur);
      const secondEnd = repeat ? null : addDays(secondStart, secondDur - 1);
      const p2 = db.prepare(`INSERT INTO phases (template_id, phase_order, title, category, icon, weekdays, periods, duration_days)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?)`).run(
        id, phase.title, phase.category, phase.icon, phase.weekdays, phase.periods, secondDur,
      ).lastInsertRowid;
      const phase2 = db.prepare('SELECT * FROM phases WHERE id = ?').get(p2);
      spawnSeries(id, phase2, { seq: 1, start_date: secondStart, end_date: secondEnd });
    })();
    return getProtocolView(id);
  }

  function getTaskById(dailyId) {
    const row = db.prepare(`${TASK_SELECT} WHERE dt.id = ?`).get(dailyId);
    return row ? mapTaskRow(row, row.date) : null;
  }

  // ── "Comprei": start a brand-new series of the original template ──
  function recreateFromFollowup(dailyTaskId, today) {
    const task = db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(dailyTaskId);
    if (!task) return { ok: false, error: 'task not found' };
    const fu = db.prepare('SELECT * FROM series WHERE id = ?').get(task.series_id);
    if (!fu) return { ok: false, error: 'series not found' };
    const fTmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(fu.template_id);
    if (!fTmpl || !fTmpl.recreate_template_id) return { ok: false, error: 'not a recreate follow-up' };

    const origId = fTmpl.recreate_template_id;
    // Invariante "1 cartela ativa": se já há uma ativa do template original
    // (ex.: clique duplo no "comprei"), não nasce uma segunda — só fecha o
    // follow-up. A cartela vigente continua valendo.
    const alreadyActive = db.prepare(
      "SELECT 1 FROM series WHERE template_id = ? AND status = 'active' LIMIT 1"
    ).get(origId);
    db.transaction(() => {
      if (!alreadyActive) {
        const phase = db.prepare('SELECT * FROM phases WHERE template_id = ? ORDER BY phase_order LIMIT 1').get(origId);
        const nextSeq = (db.prepare('SELECT MAX(seq) m FROM series WHERE template_id = ?').get(origId).m || 0) + 1;
        spawnSeries(origId, phase, { seq: nextSeq, start_date: today, end_date: null });
      }
      // The follow-up series stays completed (drops out of generation).
      db.prepare("UPDATE series SET status = 'completed', completed_at = COALESCE(completed_at, ?) WHERE id = ?")
        .run(nowIso(), fu.id);
    })();
    return { ok: true, type: 'item' };
  }

  // ── Delete from the wall screen: remove the whole item/protocol behind a
  // daily task (resolves daily_task → series → template, then reuses the admin
  // delete: archives if it has completed history, hard-deletes otherwise). ──
  function deleteByDailyTask(dailyId) {
    const task = db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(dailyId);
    if (!task) return { ok: false, error: 'task not found' };
    const serie = db.prepare('SELECT * FROM series WHERE id = ?').get(task.series_id);
    if (!serie) return { ok: false, error: 'series not found' };
    const tmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(serie.template_id);
    if (!tmpl) return { ok: false, error: 'template not found' };
    if (tmpl.kind === 'protocol') deleteProtocol(tmpl.id);
    else deleteItemPermanently(tmpl.id);
    return { ok: true };
  }

  return {
    db,
    createItem,
    deleteByDailyTask,
    createProtocol,
    generateDailyTasks,
    concludeElapsedPhases,
    toggleTask,
    recreateFromFollowup,
    recountSeries,
    // views (frozen shapes)
    getTasksView,
    getTaskById,
    getItemsView,
    getProtocolsView,
    getProtocolView,
    getCompletedView,
    itemShape,
    // admin write CRUD
    updateItem,
    deactivateItem,
    deleteItemPermanently,
    updateProtocol,
    deleteProtocol,
    convertItemToProtocol,
  };
}

// ── Migration: legacy routine_items/daily_tasks/protocols → template/phase/series ──
// Self-contained (raw SQL): runs once at boot, before createModel. Rebuilds the
// boxes of count items by slicing completed history into total_count-sized
// blocks, so each box becomes a distinct series with its own isolated history.
function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function migrate(db, today) {
  if (!tableExists(db, 'routine_items')) return; // nothing legacy to migrate
  if (tableExists(db, 'daily_tasks_legacy')) return; // already migrated (idempotent)

  db.pragma('foreign_keys = OFF');
  const run = db.transaction(() => {
    db.exec('ALTER TABLE daily_tasks RENAME TO daily_tasks_legacy');
    initSchema(db);

    const completedBefore = db.prepare('SELECT COUNT(*) c FROM daily_tasks_legacy WHERE completed = 1').get().c;

    const insTemplate = db.prepare(`
      INSERT INTO templates (name, kind, repeat_indefinitely, active, sort_order,
        followup_title, followup_category, followup_icon, followup_recreate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insPhase = db.prepare(`
      INSERT INTO phases (template_id, phase_order, title, category, icon,
        weekdays, periods, total_count, duration_days, alert_penultimate, alert_last)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insSeries = db.prepare(`
      INSERT INTO series (template_id, phase_id, seq, title, category, icon, sort_order,
        weekdays, periods, total_count, completed_count, alert_penultimate, alert_last,
        start_date, end_date, status, completed_at)
      VALUES (@template_id, @phase_id, @seq, @title, @category, @icon, @sort_order,
        @weekdays, @periods, @total_count, @completed_count, @alert_penultimate, @alert_last,
        @start_date, @end_date, @status, @completed_at)
    `);
    const insDaily = db.prepare('INSERT INTO daily_tasks (series_id, date, completed, completed_at) VALUES (?, ?, ?, ?)');
    const legacyTasks = db.prepare('SELECT * FROM daily_tasks_legacy WHERE routine_item_id = ? ORDER BY date');

    function repoint(tasks, seriesId) {
      for (const t of tasks) insDaily.run(seriesId, t.date, t.completed, t.completed_at);
    }

    function migrateSimple(ri) {
      const tmplId = insTemplate.run(ri.title, 'simple', 0, ri.active, ri.sort_order,
        null, null, null, 0).lastInsertRowid;
      const phaseId = insPhase.run(tmplId, 0, ri.title, ri.category, ri.icon,
        ri.weekdays || '[0,1,2,3,4,5,6]', ri.periods || '[]', null, null,
        ri.alert_penultimate, ri.alert_last).lastInsertRowid;
      const sid = insSeries.run({
        template_id: tmplId, phase_id: phaseId, seq: 1, title: ri.title, category: ri.category,
        icon: ri.icon, sort_order: ri.sort_order, weekdays: ri.weekdays || '[0,1,2,3,4,5,6]',
        periods: ri.periods || '[]', total_count: null, completed_count: 0,
        alert_penultimate: ri.alert_penultimate, alert_last: ri.alert_last,
        start_date: null, end_date: null, status: 'active', completed_at: null,
      }).lastInsertRowid;
      repoint(legacyTasks.all(ri.id), sid);
    }

    function migrateCount(ri) {
      const tmplId = insTemplate.run(ri.title, 'count', 1, ri.active, ri.sort_order,
        ri.followup_title, ri.followup_category, ri.followup_icon, ri.followup_recreate).lastInsertRowid;
      const phaseId = insPhase.run(tmplId, 0, ri.title, ri.category, ri.icon,
        ri.weekdays || '[0,1,2,3,4,5,6]', ri.periods || '[]', ri.total_count, null,
        ri.alert_penultimate, ri.alert_last).lastInsertRowid;

      const all = legacyTasks.all(ri.id);
      const done = all.filter((t) => t.completed);
      const pending = all.filter((t) => !t.completed);
      const total = ri.total_count;
      const nBlocks = Math.floor(done.length / total);

      const mkSeries = (seq, days, status, start, end) => insSeries.run({
        template_id: tmplId, phase_id: phaseId, seq, title: ri.title, category: ri.category,
        icon: ri.icon, sort_order: ri.sort_order, weekdays: ri.weekdays || '[0,1,2,3,4,5,6]',
        periods: ri.periods || '[]', total_count: total, completed_count: days.filter((d) => d.completed).length,
        alert_penultimate: ri.alert_penultimate, alert_last: ri.alert_last,
        start_date: start, end_date: end, status,
        completed_at: status === 'completed' ? (days[days.length - 1]?.completed_at || nowIso()) : null,
      }).lastInsertRowid;

      let seq = 1;
      for (let b = 0; b < nBlocks; b++) {
        const block = done.slice(b * total, (b + 1) * total);
        const sid = mkSeries(seq++, block, 'completed', block[0].date, block[block.length - 1].date);
        repoint(block, sid);
      }
      const rest = done.slice(nBlocks * total); // partial, still-open box
      if (rest.length > 0) {
        const sid = mkSeries(seq++, rest, 'active', rest[0].date, null);
        repoint(rest.concat(pending), sid);
      }
      // Box closed exactly (rest === 0): do NOT pre-create a fresh empty box.
      // The user must go through the "Comprar" follow-up; the next box is born
      // only via recreateFromFollowup. Pre-creating it was the "pula Comprar" bug.
    }

    function migrateProtocol(p) {
      const tmplId = insTemplate.run(p.name, 'protocol', p.repeat_indefinitely, p.active, 0,
        p.followup_title, p.followup_category, p.followup_icon, p.followup_recreate).lastInsertRowid;
      const phasesRi = db.prepare(
        'SELECT * FROM routine_items WHERE protocol_id = ? ORDER BY phase_order, id'
      ).all(p.id);
      phasesRi.forEach((ph, i) => {
        const phaseId = insPhase.run(tmplId, i, ph.title, ph.category, ph.icon,
          ph.weekdays || '[0,1,2,3,4,5,6]', ph.periods || '[]', ph.total_count,
          ph.start_date && ph.end_date ? dayCount(ph.start_date, ph.end_date) : null,
          ph.alert_penultimate, ph.alert_last).lastInsertRowid;
        const elapsed = ph.end_date && ph.end_date < today;
        const tasks = legacyTasks.all(ph.id);
        const sid = insSeries.run({
          template_id: tmplId, phase_id: phaseId, seq: 1, title: ph.title, category: ph.category,
          icon: ph.icon, sort_order: i, weekdays: ph.weekdays || '[0,1,2,3,4,5,6]',
          periods: ph.periods || '[]', total_count: ph.total_count,
          completed_count: tasks.filter((t) => t.completed).length,
          alert_penultimate: ph.alert_penultimate, alert_last: ph.alert_last,
          start_date: ph.start_date, end_date: ph.end_date,
          status: elapsed ? 'completed' : 'active', completed_at: elapsed ? (ph.end_date + 'T23:59:59Z') : null,
        }).lastInsertRowid;
        repoint(tasks, sid);
      });
    }

    const standalones = db.prepare('SELECT * FROM routine_items WHERE protocol_id IS NULL ORDER BY sort_order, id').all();
    for (const ri of standalones) {
      if (ri.total_count == null) migrateSimple(ri);
      else migrateCount(ri);
    }
    for (const p of db.prepare('SELECT * FROM protocols ORDER BY id').all()) migrateProtocol(p);

    const completedAfter = db.prepare('SELECT COUNT(*) c FROM daily_tasks WHERE completed = 1').get().c;
    if (completedAfter !== completedBefore) {
      throw new Error(`Migration invariant failed: completed ${completedBefore} → ${completedAfter}`);
    }
  });
  run();
  db.pragma('foreign_keys = ON');
}

function dayCount(startStr, endStr) {
  const [y1, m1, d1] = startStr.split('-').map(Number);
  const [y2, m2, d2] = endStr.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
}

module.exports = { initSchema, createModel, migrate, addDays };
