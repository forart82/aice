MATCH (u:Account {id: $accountId})-[r:OWNS]->(inv:Invoice)
WHERE inv.total > 100
RETURN u.email, inv.id, r.createdAt
ORDER BY inv.total DESC
LIMIT 10;
