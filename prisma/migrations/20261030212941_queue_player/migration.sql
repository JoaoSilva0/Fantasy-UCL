-- AddForeignKey
ALTER TABLE "DraftQueue" ADD CONSTRAINT "DraftQueue_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
