function buildSupplierCategoryAudit(
  supplierName,
  supplierData,
  selectedRows
) {
  const categories =
    supplierData?.categories ||
    [];

  const byId =
    new Map(
      categories.map(
        category => [
          String(
            category.id
          ),
          category
        ]
      )
    );

  const rows =
    (selectedRows || [])
      .filter(
        row =>
          row.supplier ===
          supplierName
      );

  const buckets =
    new Map();

  for (const row of rows) {
    const id =
      String(
        row.categoryId ||
        ""
      );

    if (
      !buckets.has(id)
    ) {
      buckets.set(
        id,
        {
          supplier:
            supplierName,
          categoryId:
            id,
          category:
            byId.get(id) ||
            null,
          selectedCards:
            0,
          samples: []
        }
      );
    }

    const bucket =
      buckets.get(id);

    bucket.selectedCards++;

    if (
      bucket.samples.length <
      8
    ) {
      bucket.samples.push({
        familyKey:
          row.familyKey,
        name:
          row.name
      });
    }
  }

  return {
    supplier:
      supplierName,

    categoriesParsed:
      categories.length,

    selectedCards:
      rows.length,

    usedSourceCategories:
      buckets.size,

    categories:
      [...buckets.values()]
        .sort(
          (a, b) =>
            b.selectedCards -
              a.selectedCards ||
            String(
              a.category?.path ||
              a.category?.name ||
              a.categoryId
            ).localeCompare(
              String(
                b.category?.path ||
                b.category?.name ||
                b.categoryId
              ),
              "uk"
            )
        )
  };
}

function buildCategoryAudit(
  suppliers,
  selectedRows
) {
  return {
    BEZET:
      buildSupplierCategoryAudit(
        "BEZET",
        suppliers.bezet,
        selectedRows
      ),

    MILITARIS:
      buildSupplierCategoryAudit(
        "MILITARIS",
        suppliers.militaris,
        selectedRows
      )
  };
}

module.exports = {
  buildCategoryAudit
};
