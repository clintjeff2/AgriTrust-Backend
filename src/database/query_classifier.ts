import { Pool } from 'pg';

export class QueryClassifier {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async getEstimatedTotalCost(sql: string): Promise<number | null> {
    try {
      const query = `EXPLAIN (FORMAT JSON) ${sql}`;
      const res = await this.pool.query(query);
      // pg returns rows with "QUERY PLAN" column containing JSON text/array
      const planCell = res.rows[0] && (res.rows[0]['QUERY PLAN'] ?? res.rows[0]['query plan']);
      let planObj: any = planCell;
      if (Array.isArray(planCell) && planCell.length > 0 && typeof planCell[0] === 'string') {
        planObj = JSON.parse(planCell[0]);
      } else if (typeof planCell === 'string') {
        planObj = JSON.parse(planCell);
      }

      // planObj is usually an array with first element containing Plan
      const walker = (node: any): number | null => {
        if (!node || typeof node !== 'object') return null;
        for (const k of Object.keys(node)) {
          const key = k.toLowerCase();
          if (key.includes('total') && key.includes('cost') && typeof node[k] === 'number') {
            return node[k];
          }
        }
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (Array.isArray(v)) {
            for (const el of v) {
              const found = walker(el);
              if (found != null) return found;
            }
          } else if (typeof v === 'object') {
            const found = walker(v);
            if (found != null) return found;
          }
        }
        return null;
      };

      if (Array.isArray(planObj) && planObj.length > 0) {
        const first = planObj[0];
        const maybe = first['Plan'] ?? first;
        const found = walker(maybe);
        return found;
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  async isExpensive(sql: string, threshold = 10000): Promise<boolean> {
    const cost = await this.getEstimatedTotalCost(sql);
    if (cost == null) return false;
    return cost > threshold;
  }
}

export default QueryClassifier;
