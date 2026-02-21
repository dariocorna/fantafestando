export default function AdminDashboard() {
    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Dashboard overview</h1>
            <p className="text-muted-foreground">Benvenuto nel pannello di controllo OSGFest. Da qui puoi configurare il catalogo dei prodotti, monitorare le feste attive e controllare lo storico degli ordini in tempo reale.</p>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* Placeholder cards per mockup metriche */}
                <div className="rounded-xl border bg-card text-card-foreground shadow">
                    <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
                        <h3 className="tracking-tight text-sm font-medium">Ordini Totali</h3>
                    </div>
                    <div className="p-6 pt-0">
                        <div className="text-2xl font-bold">+0</div>
                        <p className="text-xs text-muted-foreground">Oggi</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
