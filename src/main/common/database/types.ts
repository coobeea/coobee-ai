export class SqlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SqlError'
  }
}

export interface IConnection {
  execute(sql: string, params?: any[]): Promise<number>
  insert(sql: string, params?: any[]): Promise<number>
  update(sql: string, params?: any[]): Promise<number>
  delete(sql: string, params?: any[]): Promise<number>
  query(sql: string, params?: any[]): Promise<any[]>
  transaction<T>(fn: (tx: IConnection) => Promise<T>): Promise<T>
  getDbPath(): string
}
