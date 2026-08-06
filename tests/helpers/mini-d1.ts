/**
 * Minimal in-memory D1 for worker tests. Supports the SQL shapes used by
 * server/worker.ts: INSERT / SELECT (cols w/ AS, COUNT, COALESCE(SUM), GROUP BY),
 * UPDATE (incl. `SET col = col + 1` and `MAX(0, col - ?)`), DELETE — with
 * AND-joined WHERE clauses (`col = ?` / `col = 'literal'`), table aliases
 * (`emails e`), column aliases (`e.col`), optional ORDER BY / LIMIT / OFFSET.
 */

type Row = Record<string, string | number | null>

export class MiniD1 {
  tables = new Map<string, Row[]>()

  /** Column sets that must stay unique per table (PKs + UNIQUE columns). */
  uniqueCols = new Map<string, string[]>([
    ['mailboxes', ['local_part']],
    ['auth_sessions', ['token']],
    ['blocked_prefixes', ['local_part']],
    ['registrations', ['id']],
    ['emails', ['id']],
    ['rate_limits', ['key']],
  ])

  table(name: string): Row[] {
    let rows = this.tables.get(name)
    if (!rows) {
      rows = []
      this.tables.set(name, rows)
    }
    return rows
  }

  /** Enforce declared uniqueness on a fresh row; throws like D1 does. */
  enforceUnique(table: string, row: Row): void {
    for (const col of this.uniqueCols.get(table) ?? []) {
      const value = row[col]
      if (value === null || value === undefined) continue
      if (this.table(table).some((r) => String(r[col]) === String(value))) {
        throw new Error(`UNIQUE constraint failed: ${table}.${col}`)
      }
    }
  }

  prepare(sql: string) {
    const bare = new MiniStmt(this, sql, [])
    return {
      bind: (...args: unknown[]) =>
        new MiniStmt(this, sql, args.map((a) => (a === undefined ? null : (a as string | number | null)))),
      all: () => bare.all(),
      first: () => bare.first(),
      run: () => bare.run(),
    }
  }

  batch(stmts: MiniStmt[]) {
    return stmts.map((s) => s.run())
  }

  seed(table: string, rows: Row[]) {
    this.tables.set(table, rows.map((r) => ({ ...r })))
  }
}

type WhereCond = { col: string; op: '=' | '!='; param: number | null; literal: string | null }

/** Split on a separator, ignoring occurrences inside parentheses. */
function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of input) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === sep && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** Parse `col = ?` / `col != 'lit'` / `col = 0` AND-joined clauses into conditions. */
function parseWhere(where: string | null): WhereCond[] {
  if (!where) return []
  let paramIdx = 0
  return where.split(/ AND /i).map((clause) => {
    const m = clause.trim().match(/^([a-z_.]+)\s*(!=|<>|=)\s*(?:\?|'([^']*)'|"([^"]*)"|(\d+))$/i)
    if (!m) throw new Error(`MiniD1 unsupported WHERE clause: ${clause}`)
    const isParam = m[3] === undefined && m[4] === undefined && m[5] === undefined
    return {
      col: m[1].split('.').pop() ?? m[1],
      op: m[2] === '=' ? '=' : '!=',
      param: isParam ? paramIdx++ : null,
      literal: m[5] ?? m[3] ?? m[4] ?? null,
    }
  })
}

function condMatch(row: Row, c: WhereCond, args: (string | number | null)[]): boolean {
  const actual = row[c.col]
  const expected = c.param !== null ? args[c.param] : c.literal
  const eq = String(actual) === String(expected)
  return c.op === '=' ? eq : !eq
}

class MiniStmt {
  constructor(
    private db: MiniD1,
    private sql: string,
    private args: (string | number | null)[],
  ) {}

  private take(count: number): (string | number | null)[] {
    const out = this.args.slice(0, count)
    this.args = this.args.slice(count)
    return out
  }

  async all<T = Row>(): Promise<{ results: T[] }> {
    return this.query<T>()
  }

  async first<T = Row>(): Promise<T | null> {
    const { results } = this.query<T>()
    return results[0] ?? null
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const sql = this.sql.replace(/\s+/g, ' ').trim()

    if (/^INSERT INTO/i.test(sql)) {
      const m = sql.match(/^INSERT INTO\s+([a-z_]+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i)
      if (!m) throw new Error(`MiniD1 unsupported INSERT: ${sql}`)
      const table = m[1]
      const cols = m[2].split(',').map((c) => c.trim())
      const tokens = m[3].split(',').map((t) => t.trim())
      const row: Row = {}
      cols.forEach((col, i) => {
        const tok = tokens[i]
        if (tok === '?') row[col] = this.take(1)[0]
        else if (/^'[^']*'$/.test(tok)) row[col] = tok.slice(1, -1)
        else {
          const n = Number(tok)
          row[col] = Number.isNaN(n) ? tok : n
        }
      })
      if (/ON CONFLICT/i.test(sql)) {
        const existing = this.db.table(table).find((r) => cols.every((c) => r[c] !== undefined && String(r[c]) === String(row[c])))
        if (existing) {
          for (const c of cols) existing[c] = row[c]
          return { meta: { changes: 1 } }
        }
      }
      this.db.enforceUnique(table, row)
      this.db.table(table).push(row)
      return { meta: { changes: 1 } }
    }

    if (/^UPDATE/i.test(sql)) {
      const m = sql.match(/^UPDATE\s+([a-z_]+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i)
      if (!m) throw new Error(`MiniD1 unsupported UPDATE: ${sql}`)
      const table = m[1]
      const conds = parseWhere(m[3] ?? null)
      const setExprs = splitTopLevel(m[2], ',').map((part) => {
        const sm = part.match(/^([a-z_]+)\s*=\s*(.+)$/i)
        if (!sm) throw new Error(`MiniD1 unsupported SET: ${part}`)
        return { col: sm[1], expr: sm[2].trim() }
      })
      // bind order: SET placeholders first, then WHERE placeholders
      const setArgs = this.take(setExprs.filter((e) => e.expr === '?' || /^MAX\(0,\s*[a-z_]+ - \?\)$/i.test(e.expr)).length)
      const whereArgs = this.take(conds.filter((c) => c.param !== null).length)
      let changes = 0
      for (const row of this.db.table(table)) {
        if (!conds.every((c) => condMatch(row, c, whereArgs))) continue
        let setIdx = 0
        for (const { col, expr } of setExprs) {
          if (expr === '?') {
            row[col] = setArgs[setIdx++]
          } else if (/^[a-z_]+ \+ 1$/i.test(expr)) {
            row[col] = (Number(row[col]) || 0) + 1
          } else if (/^MAX\(0,\s*[a-z_]+ - \?\)$/i.test(expr)) {
            row[col] = Math.max(0, (Number(row[col]) || 0) - Number(setArgs[setIdx++]))
          } else if (/^-?\d+$/.test(expr)) {
            row[col] = Number(expr)
          } else if (/^'[^']*'$/.test(expr)) {
            row[col] = expr.slice(1, -1)
          } else {
            throw new Error(`MiniD1 unsupported expr: ${expr}`)
          }
        }
        changes++
      }
      return { meta: { changes } }
    }

    if (/^DELETE FROM/i.test(sql)) {
      const m = sql.match(/^DELETE FROM\s+([a-z_]+)(?:\s+WHERE\s+(.+))?$/i)
      if (!m) throw new Error(`MiniD1 unsupported DELETE: ${sql}`)
      const where = m[2] ?? ''
      const inMatch = where.match(/^([a-z_.]+)\s+IN\s*\(\s*\?(?:\s*,\s*\?)*\s*\)$/i)
      if (inMatch) {
        const col = inMatch[1].split('.').pop() ?? inMatch[1]
        const n = (inMatch[0].match(/\?/g) ?? []).length
        const values = this.take(n).map(String)
        const rows = this.db.table(m[1])
        const before = rows.length
        const kept = rows.filter((r) => !values.includes(String(r[col])))
        this.db.tables.set(m[1], kept)
        return { meta: { changes: before - kept.length } }
      }
      const conds = parseWhere(where)
      const whereArgs = this.take(conds.filter((c) => c.param !== null).length)
      const rows = this.db.table(m[1])
      const before = rows.length
      const kept = rows.filter((r) => !conds.every((c) => condMatch(r, c, whereArgs)))
      this.db.tables.set(m[1], kept)
      return { meta: { changes: before - kept.length } }
    }

    throw new Error(`MiniD1 unsupported statement: ${sql}`)
  }

  private query<T = Row>(): { results: T[] } {
    const sql = this.sql.replace(/\s+/g, ' ').trim()
    const m = sql.match(
      /^SELECT\s+(.+?)\s+FROM\s+([a-z_]+)(?:\s+[a-z_]+)?(?:\s+INNER JOIN\s+[a-z_]+\s+[a-z_]+\s+ON\s+[^ ]+\s*=\s*[^ ]+)?(?:\s+WHERE\s+(.+?))?(?:\s+GROUP BY\s+[a-z_.]+)?(?:\s+ORDER BY\s+(.+?))?(?:\s+LIMIT\s+\?)?(?:\s+OFFSET\s+\?)?$/i,
    )
    if (!m) throw new Error(`MiniD1 unsupported SELECT: ${sql}`)
    const select = m[1].trim()
    const table = m[2]
    const conds = parseWhere(m[3] ?? null)
    const whereArgs = this.take(conds.filter((c) => c.param !== null).length)
    const orderBy = m[4] ?? null

    const rows = this.db.table(table).filter((r) => conds.every((c) => condMatch(r, c, whereArgs)))

    if (/^COUNT\(\*\)/i.test(select)) {
      const alias = select.match(/AS\s+([a-z_]+)$/i)?.[1] ?? 'n'
      const limit = /LIMIT \?/i.test(sql) ? Number(this.take(1)[0]) : rows.length
      return { results: [{ [alias]: Math.min(rows.length, limit) }] as T[] }
    }

    if (/^COALESCE\(SUM/i.test(select)) {
      const rawCol = select.match(/SUM\(([a-z_.]+)\)/i)?.[1] ?? ''
      const col = rawCol.split('.')[1] ?? rawCol
      const alias = select.match(/AS\s+([a-z_]+)$/i)?.[1] ?? 'n'
      return { results: [{ [alias]: rows.reduce((s, r) => s + (Number(r[col]) || 0), 0) }] as T[] }
    }

    if (/GROUP BY/i.test(sql)) {
      const col = (select.match(/^([a-z_.]+),\s*COUNT/i)?.[1] ?? 'folder').split('.')[1] ?? 'folder'
      const alias = select.match(/AS\s+([a-z_]+)$/i)?.[1] ?? 'count'
      const groups = new Map<string, number>()
      for (const r of rows) {
        const k = String(r[col] ?? 'inbox')
        groups.set(k, (groups.get(k) ?? 0) + 1)
      }
      return { results: [...groups.entries()].map(([k, count]) => ({ [col]: k, [alias]: count })) as T[] }
    }

    let sorted = rows
    if (orderBy) {
      const om = orderBy.match(/^([a-z_.]+)\s+(DESC|ASC)?$/i)
      if (om) {
        const col = om[1].split('.')[1] ?? om[1]
        const dir = (om[2] ?? 'ASC').toUpperCase()
        sorted = [...rows].sort((a, b) => {
          const av = a[col] ?? ''
          const bv = b[col] ?? ''
          const cmp = String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0
          return dir === 'DESC' ? -cmp : cmp
        })
      }
    }

    const limit = /LIMIT \?/i.test(sql) ? Number(this.take(1)[0]) : sorted.length
    const offset = /OFFSET \?/i.test(sql) ? Number(this.take(1)[0]) : 0
    const page = sorted.slice(offset, offset + limit)

    const cols = select.split(',').map((c) => c.trim())
    return {
      results: page.map((r) => {
        const out: Row = {}
        for (const c of cols) {
          const cm = c.match(/^([a-z_.]+)(?:\s+AS\s+([a-z_]+))?$/i)
          if (!cm) throw new Error(`MiniD1 unsupported column: ${c}`)
          const key = cm[1].split('.')[1] ?? cm[1]
          out[cm[2] ?? key] = r[key] ?? null
        }
        return out as T
      }),
    }
  }
}
