-- AddForeignKey
ALTER TABLE "LeaguePlayerPoints" ADD CONSTRAINT "LeaguePlayerPoints_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;
