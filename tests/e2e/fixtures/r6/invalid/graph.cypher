MATCH (src:Account)-[tx:TRANSFERRED]->(dst:Account)
WHERE tx.amount > AND
RETURN ;
