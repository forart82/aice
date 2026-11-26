CREATE PROCEDURE dbo.ProcessLedgerBatch
  @BatchId INT
AS
BEGIN
  BEGIN TRY
    UPDATE dbo.Accounts SET Balance = WHERE BatchId = @BatchId;
  END TRY
  BEGIN CATCH
    SELECT ;
  END CATCH
END;
GO
