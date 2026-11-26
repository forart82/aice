MERGE (m:Merchant { code: $merchantCode })
ON CREATE SET m.createdAt = timestamp(), m.tier = "standard"
WITH m
MATCH (m)-[:ISSUED]->(inv:Invoice)
WHERE inv.status = $status AND inv.totalCents >= $minCents
OPTIONAL MATCH (inv)-[rel:CONTAINS]->(item:Sku)
RETURN m.code AS merchant,
       inv.number AS invoiceNumber,
       inv.totalCents AS totalCents,
       count(rel) AS lineCount
ORDER BY inv.totalCents DESC
LIMIT 25;
