// Occurrence governance routes (each daily_task of a repeated item): list,
// add a day by hand, mark/unmark, soft-remove/restore, bulk-remove unmarked
// past days that no longer fit the rule. Mounted by /api (session) and by
// /integration/v1 (bearer token) so both expose the same contract.
const {
  getOccurrences,
  addOccurrence,
  setOccurrenceCompleted,
  removeOccurrence,
  pruneOffRule,
} = require('../db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Format AND a real calendar day (rejects 2026-02-31, 2026-13-45).
function isDate(v) {
  if (!DATE_RE.test(String(v || ''))) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function mountOccurrences(router, guard) {
  router.get('/items/:id/occurrences', guard, (req, res) => {
    const { from, to } = req.query;
    for (const d of [from, to]) {
      if (d !== undefined && !isDate(d)) return res.status(400).json({ error: 'from/to must be valid YYYY-MM-DD days' });
    }
    const list = getOccurrences(Number(req.params.id), { from, to });
    if (!list) return res.status(404).json({ error: 'Item not found' });
    res.json(list);
  });

  router.post('/items/:id/occurrences', guard, (req, res) => {
    const date = req.body && req.body.date;
    if (!isDate(date)) return res.status(400).json({ error: 'date must be a valid YYYY-MM-DD day' });
    const result = addOccurrence(Number(req.params.id), date);
    if (!result.ok) return res.status(409).json(result);
    res.status(201).json(result.occurrence);
  });

  router.post('/items/:id/occurrences/prune', guard, (req, res) => {
    const dryRun = !!(req.body && req.body.dry_run);
    if (!getOccurrences(Number(req.params.id), {})) return res.status(404).json({ error: 'Item not found' });
    const removed = pruneOffRule(Number(req.params.id), dryRun);
    res.json({ dry_run: dryRun, count: removed.length, occurrences: removed });
  });

  router.put('/occurrences/:id', guard, (req, res) => {
    const { completed, removed } = req.body || {};
    const isBool = (v) => v === true || v === false || v === 1 || v === 0;
    if (completed === undefined && removed === undefined) return res.status(400).json({ error: 'send completed or removed (boolean)' });
    if ((completed !== undefined && !isBool(completed)) || (removed !== undefined && !isBool(removed))) {
      return res.status(400).json({ error: 'completed/removed must be boolean' });
    }
    const id = Number(req.params.id);
    let occ = removed !== undefined ? removeOccurrence(id, !!removed) : null;
    if (occ && occ.error) return res.status(409).json(occ);
    if (completed !== undefined) {
      occ = setOccurrenceCompleted(id, completed);
      // Refused silently by the model (removed day, cartela at its total): say so.
      if (occ && !!occ.completed !== !!completed) {
        return res.status(409).json({ error: occ.removed_at ? 'occurrence is removed: restore it first' : 'cartela already at its total' });
      }
    }
    if (!occ) return res.status(404).json({ error: 'Occurrence not found' });
    res.json(occ);
  });

  router.delete('/occurrences/:id', guard, (req, res) => {
    const occ = removeOccurrence(Number(req.params.id), true);
    if (!occ) return res.status(404).json({ error: 'Occurrence not found' });
    res.json(occ);
  });
}

module.exports = { mountOccurrences };
