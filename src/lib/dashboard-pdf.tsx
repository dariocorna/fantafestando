import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer"
import { formatDashboardDateTime, type DashboardStatsResult } from "./dashboard-stats"
import {
    buildProductSalesCategorySummaries,
    type ProductSalesBreakdownResult,
    type ProductSalesBreakdownRow
} from "./product-consumption"

export interface DashboardPdfInput {
    eventName: string
    stats: DashboardStatsResult
    sales: ProductSalesBreakdownResult
    intervalLabel?: string
    timezone?: string
}

export interface CategorySalesRow {
    key: string
    name: string
    quantity: number
    grossAmount: number
    discountAmount: number
    netAmount: number
}

export interface DashboardPdfPageChunk {
    showOverview: boolean
    categoryRows?: CategorySalesRow[]
    productRows?: ProductSalesBreakdownRow[]
}

const FIRST_CATEGORY_PAGE_SIZE = 10
const CATEGORY_PAGE_SIZE = 18
const PRODUCT_PAGE_SIZE = 10

const moneyFormatter = new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
})

const integerFormatter = new Intl.NumberFormat("it-IT")

const styles = StyleSheet.create({
    page: {
        paddingTop: 76,
        paddingRight: 36,
        paddingBottom: 52,
        paddingLeft: 36,
        fontFamily: "Helvetica",
        fontSize: 8.5,
        color: "#172033"
    },
    header: {
        position: "absolute",
        top: 24,
        left: 36,
        right: 36,
        height: 36,
        borderBottomWidth: 1,
        borderBottomColor: "#d9e6f8",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between"
    },
    brand: {
        fontSize: 13,
        fontFamily: "Helvetica-Bold",
        color: "#0b4f8a"
    },
    headerTitle: {
        maxWidth: 320,
        fontSize: 9,
        textAlign: "right",
        color: "#44546a"
    },
    footer: {
        position: "absolute",
        bottom: 20,
        left: 36,
        right: 36,
        borderTopWidth: 1,
        borderTopColor: "#d9e6f8",
        paddingTop: 7,
        flexDirection: "row",
        justifyContent: "space-between",
        color: "#667085",
        fontSize: 7.5
    },
    title: {
        fontSize: 20,
        fontFamily: "Helvetica-Bold",
        color: "#0b4f8a",
        marginBottom: 6
    },
    metadata: {
        color: "#4b5565",
        lineHeight: 1.45,
        marginBottom: 18
    },
    section: {
        marginBottom: 18
    },
    sectionTitle: {
        fontSize: 12,
        fontFamily: "Helvetica-Bold",
        color: "#0b4f8a",
        marginBottom: 8
    },
    cardRow: {
        flexDirection: "row",
        justifyContent: "space-between"
    },
    card: {
        width: "32%",
        borderWidth: 1,
        borderColor: "#d9e6f8",
        borderRadius: 4,
        padding: 10,
        backgroundColor: "#f8fbff"
    },
    cardLabel: {
        color: "#667085",
        fontSize: 7.5,
        marginBottom: 4
    },
    cardValue: {
        color: "#172033",
        fontFamily: "Helvetica-Bold",
        fontSize: 13
    },
    tableHeader: {
        flexDirection: "row",
        backgroundColor: "#0b4f8a",
        color: "#ffffff",
        fontFamily: "Helvetica-Bold",
        borderTopLeftRadius: 3,
        borderTopRightRadius: 3
    },
    tableRow: {
        flexDirection: "row",
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderLeftWidth: 1,
        borderColor: "#d9e6f8",
        minHeight: 24,
        alignItems: "center"
    },
    tableRowAlternate: {
        backgroundColor: "#f8fbff"
    },
    productTableRow: {
        minHeight: 44
    },
    cell: {
        paddingVertical: 6,
        paddingHorizontal: 5
    },
    tableAmount: {
        fontSize: 7.5
    },
    discountDetail: {
        color: "#667085",
        fontSize: 6.8,
        lineHeight: 1.2,
        marginTop: 2
    },
    twoLineText: {
        maxLines: 2,
        textOverflow: "ellipsis"
    },
    threeLineText: {
        maxLines: 3,
        textOverflow: "ellipsis"
    },
    fourLineText: {
        maxLines: 4,
        textOverflow: "ellipsis"
    },
    oneLineText: {
        maxLines: 1,
        textOverflow: "ellipsis"
    },
    numericCell: {
        textAlign: "right"
    },
    empty: {
        borderWidth: 1,
        borderColor: "#d9e6f8",
        borderRadius: 3,
        padding: 12,
        color: "#667085",
        textAlign: "center"
    }
})

function money(value: number): string {
    return `${moneyFormatter.format(value)} EUR`
}

function amount(value: number): string {
    return moneyFormatter.format(value)
}

export function buildDashboardPdfCategoryRows(sales: ProductSalesBreakdownResult): CategorySalesRow[] {
    return buildProductSalesCategorySummaries(sales).map((summary) => ({
        key: summary.key,
        name: summary.name,
        quantity: summary.quantitySold,
        grossAmount: summary.grossAmount,
        discountAmount: summary.discountAmount,
        netAmount: summary.netAmount
    }))
}

export function buildDashboardPdfPages(sales: ProductSalesBreakdownResult): DashboardPdfPageChunk[] {
    const categoryRows = buildDashboardPdfCategoryRows(sales)
    const pages: DashboardPdfPageChunk[] = [{
        showOverview: true,
        categoryRows: categoryRows.slice(0, FIRST_CATEGORY_PAGE_SIZE)
    }]

    for (let index = FIRST_CATEGORY_PAGE_SIZE; index < categoryRows.length; index += CATEGORY_PAGE_SIZE) {
        pages.push({
            showOverview: false,
            categoryRows: categoryRows.slice(index, index + CATEGORY_PAGE_SIZE)
        })
    }

    for (let index = 0; index < sales.rows.length; index += PRODUCT_PAGE_SIZE) {
        pages.push({
            showOverview: false,
            productRows: sales.rows.slice(index, index + PRODUCT_PAGE_SIZE)
        })
    }

    if (sales.rows.length === 0) pages[0].productRows = []
    return pages
}

function ReportHeader({ eventName }: { eventName: string }) {
    return (
        <View style={styles.header}>
            <Text style={styles.brand}>FANTAFESTANDO</Text>
            <Text style={styles.headerTitle}>Report dashboard · {eventName}</Text>
        </View>
    )
}

function ReportFooter({ eventName }: { eventName: string }) {
    return (
        <View style={styles.footer}>
            <Text>{eventName}</Text>
            <Text render={({ pageNumber, totalPages }) => `Pagina ${pageNumber} di ${totalPages}`} />
        </View>
    )
}

function CategorySalesTable({ rows }: { rows: CategorySalesRow[] }) {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Vendite per categoria (importi in EUR)</Text>
            {rows.length === 0 ? (
                <Text style={styles.empty}>Nessuna vendita nell&apos;intervallo selezionato.</Text>
            ) : (
                <View>
                    <View style={styles.tableHeader} wrap={false}>
                        <Text style={[styles.cell, { width: "36%" }]}>Categoria</Text>
                        <Text style={[styles.cell, styles.numericCell, { width: "12%" }]}>Quantità</Text>
                        <Text style={[styles.cell, styles.numericCell, { width: "18%" }]}>Lordo</Text>
                        <Text style={[styles.cell, styles.numericCell, { width: "16%" }]}>Sconti</Text>
                        <Text style={[styles.cell, styles.numericCell, { width: "18%" }]}>Netto</Text>
                    </View>
                    {rows.map((row, index) => (
                        <View key={row.key} style={[styles.tableRow, index % 2 ? styles.tableRowAlternate : {}]} wrap={false}>
                            <Text style={[styles.cell, styles.twoLineText, { width: "36%" }]}>{row.name}</Text>
                            <Text style={[styles.cell, styles.numericCell, { width: "12%" }]}>{integerFormatter.format(row.quantity)}</Text>
                            <Text style={[styles.cell, styles.numericCell, styles.tableAmount, { width: "18%" }]}>{amount(row.grossAmount)}</Text>
                            <Text style={[styles.cell, styles.numericCell, styles.tableAmount, { width: "16%" }]}>{amount(row.discountAmount)}</Text>
                            <Text style={[styles.cell, styles.numericCell, styles.tableAmount, { width: "18%" }]}>{amount(row.netAmount)}</Text>
                        </View>
                    ))}
                </View>
            )}
        </View>
    )
}

function ProductSalesTable({ rows }: { rows: ProductSalesBreakdownRow[] }) {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Vendite per prodotto (importi in EUR)</Text>
            {rows.length === 0 ? (
                <Text style={styles.empty}>Nessun prodotto venduto nell&apos;intervallo selezionato.</Text>
            ) : (
                <View>
                    <View style={styles.tableHeader} wrap={false}>
                        <Text style={[styles.cell, { width: "17%" }]}>Categoria</Text>
                        <Text style={[styles.cell, { width: "20%" }]}>Prodotto</Text>
                        <Text style={[styles.cell, { width: "24%" }]}>Regime / sconto</Text>
                        <Text style={[styles.cell, styles.numericCell, { width: "7%" }]}>Q.tà</Text>
                        <Text style={[styles.cell, styles.numericCell, { width: "11%" }]}>Lordo</Text>
                        <Text style={[styles.cell, styles.numericCell, { width: "10%" }]}>Sconto</Text>
                        <Text style={[styles.cell, styles.numericCell, { width: "11%" }]}>Netto</Text>
                    </View>
                    {rows.map((row, index) => (
                        <View
                            key={JSON.stringify([
                                row.categoryKey ? `key:${row.categoryKey}` : `name:${row.categoryName}`,
                                row.productKey,
                                row.pricingRegime,
                                row.discountLabel,
                                row.discountMode,
                                row.discountValue
                            ])}
                            style={[styles.tableRow, styles.productTableRow, index % 2 ? styles.tableRowAlternate : {}]}
                            wrap={false}
                        >
                            <Text style={[styles.cell, styles.threeLineText, { width: "17%" }]}>{row.categoryName}</Text>
                            <Text style={[styles.cell, styles.fourLineText, { width: "20%" }]}>{row.productName}</Text>
                            <View style={[styles.cell, { width: "24%" }]}>
                                <Text>{row.pricingRegime === "SCONTATO" ? "Scontato" : "Pieno"}</Text>
                                {row.pricingRegime === "SCONTATO" ? (
                                    <>
                                        <Text style={[styles.discountDetail, styles.oneLineText]}>{row.discountLabel}</Text>
                                        <Text style={[styles.discountDetail, styles.oneLineText]}>{row.discountValue}</Text>
                                    </>
                                ) : null}
                            </View>
                            <Text style={[styles.cell, styles.numericCell, { width: "7%" }]}>{integerFormatter.format(row.quantitySold)}</Text>
                            <Text style={[styles.cell, styles.numericCell, styles.tableAmount, { width: "11%" }]}>{amount(row.grossAmount)}</Text>
                            <Text style={[styles.cell, styles.numericCell, styles.tableAmount, { width: "10%" }]}>{amount(row.discountAmount)}</Text>
                            <Text style={[styles.cell, styles.numericCell, styles.tableAmount, { width: "11%" }]}>{amount(row.netAmount)}</Text>
                        </View>
                    ))}
                </View>
            )}
        </View>
    )
}

function DashboardPdfDocument({ eventName, stats, sales, intervalLabel, timezone }: DashboardPdfInput) {
    const pages = buildDashboardPdfPages(sales)
    const kpis = [
        ["Incasso totale", money(stats.summary.totalRevenue)],
        ["Ordini saldati", integerFormatter.format(stats.summary.paidOrdersCount)],
        ["Ticket medio", money(stats.summary.averageTicket)]
    ]
    const payments = [
        ["Contanti", stats.summary.cashRevenue],
        ["Carta / POS", stats.summary.cardRevenue],
        ["Altro", stats.summary.otherRevenue]
    ] as const

    return (
        <Document title={`Report dashboard - ${eventName}`} author="FantaFestando">
            {pages.map((page, pageIndex) => (
                <Page key={pageIndex} size="A4" style={styles.page} wrap>
                    <ReportHeader eventName={eventName} />
                    <ReportFooter eventName={eventName} />

                    {page.showOverview ? (
                        <>
                            <Text style={styles.title}>Report dashboard</Text>
                            <View style={styles.metadata}>
                                <Text>Festa: {eventName}</Text>
                                <Text>Intervallo: {intervalLabel || "Intera festa"}</Text>
                                <Text>Generato il: {formatDashboardDateTime(stats.generatedAt, timezone)}</Text>
                            </View>

                            <View style={styles.section} wrap={false}>
                                <Text style={styles.sectionTitle}>Indicatori principali</Text>
                                <View style={styles.cardRow}>
                                    {kpis.map(([label, value]) => (
                                        <View key={label} style={styles.card}>
                                            <Text style={styles.cardLabel}>{label}</Text>
                                            <Text style={styles.cardValue}>{value}</Text>
                                        </View>
                                    ))}
                                </View>
                            </View>

                            <View style={styles.section} wrap={false}>
                                <Text style={styles.sectionTitle}>Ripartizione pagamenti</Text>
                                <View style={styles.cardRow}>
                                    {payments.map(([label, value]) => (
                                        <View key={label} style={styles.card}>
                                            <Text style={styles.cardLabel}>{label}</Text>
                                            <Text style={styles.cardValue}>{money(value)}</Text>
                                        </View>
                                    ))}
                                </View>
                            </View>
                        </>
                    ) : null}

                    {page.categoryRows ? <CategorySalesTable rows={page.categoryRows} /> : null}
                    {page.productRows ? <ProductSalesTable rows={page.productRows} /> : null}
                </Page>
            ))}
        </Document>
    )
}

export async function buildDashboardPdfBuffer(input: DashboardPdfInput): Promise<Buffer> {
    return renderToBuffer(<DashboardPdfDocument {...input} />)
}
