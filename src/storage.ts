import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { indexRepository, type RepositoryIndex, type FileRecord, type SymbolRecord } from './index.js';
import { analyzeRepository, type RepositoryProfile } from './intelligence.js';

export type DatabaseStats = { database: string; repository: string; indexedAt: string; files: number; symbols: number; dependencies: number; conventions: number };

export class RepositoryStore {
  private db: DatabaseSync;
  readonly filename: string;
  constructor(filename = 'data/codedeft.db') {
    this.filename = path.resolve(filename);
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    this.db = new DatabaseSync(this.filename);
    this.db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS repositories (
        id INTEGER PRIMARY KEY, root TEXT NOT NULL UNIQUE, indexed_at TEXT NOT NULL, profile_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY, repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        path TEXT NOT NULL, content TEXT NOT NULL, imports_json TEXT NOT NULL,
        UNIQUE(repository_id, path)
      );
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        name TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL, exported INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS dependencies (
        repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        from_path TEXT NOT NULL, to_path TEXT NOT NULL,
        PRIMARY KEY(repository_id, from_path, to_path)
      );
      CREATE TABLE IF NOT EXISTS conventions (
        repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        convention_id TEXT NOT NULL, description TEXT NOT NULL, evidence_json TEXT NOT NULL, confidence REAL NOT NULL,
        PRIMARY KEY(repository_id, convention_id)
      );
      CREATE INDEX IF NOT EXISTS idx_files_repository ON files(repository_id);
      CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_dependencies_from ON dependencies(repository_id, from_path);
    `);
  }
  close(): void { this.db.close(); }
  save(index: RepositoryIndex): DatabaseStats {
    const profile = analyzeRepository(index);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT INTO repositories(root,indexed_at,profile_json) VALUES(?,?,?)
        ON CONFLICT(root) DO UPDATE SET indexed_at=excluded.indexed_at, profile_json=excluded.profile_json`)
        .run(index.root, index.indexedAt, JSON.stringify(profile));
      const repoId = Number((this.db.prepare('SELECT id FROM repositories WHERE root=?').get(index.root) as {id:number}).id);
      // Full replacement makes removed files and edges disappear reliably.
      this.db.prepare('DELETE FROM files WHERE repository_id=?').run(repoId);
      this.db.prepare('DELETE FROM dependencies WHERE repository_id=?').run(repoId);
      this.db.prepare('DELETE FROM conventions WHERE repository_id=?').run(repoId);
      const insertFile = this.db.prepare('INSERT INTO files(repository_id,path,content,imports_json) VALUES(?,?,?,?)');
      const insertSymbol = this.db.prepare('INSERT INTO symbols(file_id,name,kind,line,exported) VALUES(?,?,?,?,?)');
      for (const file of index.files) {
        const result = insertFile.run(repoId,file.path,file.content,JSON.stringify(file.imports));
        const fileId = Number(result.lastInsertRowid);
        for (const symbol of file.symbols) insertSymbol.run(fileId,symbol.name,symbol.kind,symbol.line,symbol.exported?1:0);
      }
      const insertEdge=this.db.prepare('INSERT OR IGNORE INTO dependencies(repository_id,from_path,to_path) VALUES(?,?,?)');
      for (const edge of index.edges) insertEdge.run(repoId,edge.from,edge.to);
      const insertConvention=this.db.prepare('INSERT INTO conventions(repository_id,convention_id,description,evidence_json,confidence) VALUES(?,?,?,?,?)');
      for(const c of profile.conventions)insertConvention.run(repoId,c.id,c.description,JSON.stringify(c.evidence),c.confidence);
      this.db.exec('COMMIT');
      return this.stats(index.root);
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  index(root:string):DatabaseStats { return this.save(indexRepository(root)); }
  load(root:string):RepositoryIndex {
    const canonical=fs.realpathSync(root);
    const repo=this.db.prepare('SELECT id,indexed_at FROM repositories WHERE root=?').get(canonical) as {id:number;indexed_at:string}|undefined;
    if(!repo)throw new Error(`Repository not indexed: ${canonical}. Run: codedeft db-index ${canonical}`);
    const rows=this.db.prepare('SELECT id,path,content,imports_json FROM files WHERE repository_id=? ORDER BY path').all(repo.id) as {id:number;path:string;content:string;imports_json:string}[];
    const selectSymbols=this.db.prepare('SELECT name,kind,line,exported FROM symbols WHERE file_id=? ORDER BY id');
    const files:FileRecord[]=rows.map(row=>({path:row.path,content:row.content,imports:JSON.parse(row.imports_json) as string[],symbols:(selectSymbols.all(row.id) as {name:string;kind:string;line:number;exported:number}[]).map(s=>({name:s.name,kind:s.kind,line:s.line,exported:!!s.exported,file:row.path} as SymbolRecord))}));
    const edges=this.db.prepare('SELECT from_path AS `from`,to_path AS `to` FROM dependencies WHERE repository_id=? ORDER BY from_path,to_path').all(repo.id) as {from:string;to:string}[];
    const normalizedEdges=edges.map(e=>({from:e.from,to:e.to}));
    return {root:canonical,files,edges:normalizedEdges,indexedAt:repo.indexed_at};
  }
  profile(root:string):RepositoryProfile {
    const canonical=fs.realpathSync(root);
    const row=this.db.prepare('SELECT profile_json FROM repositories WHERE root=?').get(canonical) as {profile_json:string}|undefined;
    if(!row)throw new Error(`Repository not indexed: ${canonical}`);
    return JSON.parse(row.profile_json) as RepositoryProfile;
  }
  stats(root:string):DatabaseStats {
    const canonical=fs.realpathSync(root);
    const repo=this.db.prepare('SELECT id,indexed_at FROM repositories WHERE root=?').get(canonical) as {id:number;indexed_at:string}|undefined;
    if(!repo)throw new Error(`Repository not indexed: ${canonical}`);
    const count=(table:string,field:string)=>Number((this.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${field}=?`).get(repo.id) as {n:number}).n);
    const symbols=Number((this.db.prepare('SELECT count(*) AS n FROM symbols s JOIN files f ON f.id=s.file_id WHERE f.repository_id=?').get(repo.id) as {n:number}).n);
    return {database:this.filename,repository:canonical,indexedAt:repo.indexed_at,files:count('files','repository_id'),symbols,dependencies:count('dependencies','repository_id'),conventions:count('conventions','repository_id')};
  }
}
