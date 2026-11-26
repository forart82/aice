CREATE TABLE [dbo].[SyncCheckpoints] (
    [CheckpointId] NVARCHAR(64) NOT NULL PRIMARY KEY,
    [StreamName] NVARCHAR(128) NOT NULL,
    [LastOffset] BIGINT NOT NULL,
    [UpdatedAtUtc] DATETIME2 NOT NULL
);
GO

CREATE PROCEDURE [dbo].[UpsertCheckpoint]
    @CheckpointId NVARCHAR(64),
    @StreamName NVARCHAR(128),
    @LastOffset BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF EXISTS (SELECT 1 FROM [dbo].[SyncCheckpoints] WHERE [CheckpointId] = @CheckpointId)
        BEGIN
            UPDATE [dbo].[SyncCheckpoints]
            SET [LastOffset] = @LastOffset, [UpdatedAtUtc] = SYSUTCDATETIME()
            WHERE [CheckpointId] = @CheckpointId;
        END
        ELSE
        BEGIN
            INSERT INTO [dbo].[SyncCheckpoints] ([CheckpointId], [StreamName], [LastOffset], [UpdatedAtUtc])
            VALUES (@CheckpointId, @StreamName, @LastOffset, SYSUTCDATETIME());
        END
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
GO
