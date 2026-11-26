CREATE PROCEDURE dbo.ProcessLedgerBatch
  @BatchId INT,
  @Delta MONEY
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    UPDATE dbo.Accounts
    SET Balance = Balance + @Delta
    WHERE BatchId = @BatchId;
  END TRY
  BEGIN CATCH
    THROW;
  END CATCH
END;
GO
