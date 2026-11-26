MATCH (src:Account)-[tx:TRANSFERRED]->(dst:Account)
WHERE tx.amount > 0 AND src.active = true
RETURN src.id, dst.id, sum(tx.amount) AS total_moved
ORDER BY total_moved DESC
LIMIT 25;
