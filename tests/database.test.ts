import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repository } from '../server/db.js';

test('repeated parameterized reads and writes reuse statements without stale bindings or broken rollback', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE values_test(id INTEGER PRIMARY KEY,value TEXT)');
  const originalPrepare = db.prepare.bind(db);
  let prepared = 0;
  db.prepare = sql => { prepared++; return originalPrepare(sql); };
  const repo = new Repository(db);
  try {
    for (let index = 0; index < 1000; index++) {
      repo.run('INSERT INTO values_test(id,value) VALUES (?,?)', index, index % 2 ? `value-${index}` : null);
      assert.equal(repo.get('SELECT value FROM values_test WHERE id=?', index)!.value, index % 2 ? `value-${index}` : null);
      assert.deepEqual(repo.all('SELECT value FROM values_test WHERE id=?', index).map(row => row.value), [index % 2 ? `value-${index}` : null]);
    }
    assert.equal(prepared, 2, 'One native prepare for the insert and one for the shared read SQL');
    assert.throws(() => repo.transaction(() => { repo.run('UPDATE values_test SET value=? WHERE id=?', 'rolled-back', 1); throw new Error('rollback'); }), /rollback/);
    assert.equal(repo.get('SELECT value FROM values_test WHERE id=?', 1)!.value, 'value-1');
    repo.transaction(() => repo.run('UPDATE values_test SET value=? WHERE id=?', 'committed', 1));
    assert.equal(repo.get('SELECT value FROM values_test WHERE id=?', 1)!.value, 'committed');
  } finally { repo.close(); }
  assert.equal(db.isOpen, false); assert.equal(repo.preparedStatementCount, 0);
});

test('statement cache stays bounded through varying SQL and closure invalidates held native handles', () => {
  const db = new DatabaseSync(':memory:'); const repo = new Repository(db);
  const held = db.prepare('SELECT 42 AS value');
  try {
    for (let index = 0; index < 512; index++) {
      assert.equal(repo.get(`SELECT ? AS value /* query ${index} */`, index)!.value, index);
      assert.ok(repo.preparedStatementCount <= 128);
    }
    assert.equal(repo.preparedStatementCount, 128);
    assert.equal(repo.get('SELECT ? AS value /* query 0 */', 'recompiled')!.value, 'recompiled', 'An evicted statement is safely prepared again');
    assert.equal(repo.preparedStatementCount, 128);
  } finally { repo.close(); }
  assert.equal(repo.preparedStatementCount, 0);
  assert.throws(() => held.get(), /finalized|closed|not open|database/i);
  assert.throws(() => repo.get('SELECT 1'), /closed/);
  assert.doesNotThrow(() => repo.close());
});
