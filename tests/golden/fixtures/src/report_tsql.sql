CREATE PROCEDURE dbo.usp_SyncLedger
  @BatchId INT
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    SELECT TOP (10) [id], [owner_name], [balance]
    FROM [dbo].[accounts]
    WHERE [id] >= @BatchId;
  END TRY
  BEGIN CATCH
    THROW;
  END CATCH;
END;
GO
