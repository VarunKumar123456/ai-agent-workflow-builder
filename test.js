fetch("https://ldgrygndkfjrcjbiiilp.graphql.ap-south-1.nhost.run/v1", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-hasura-admin-secret": "Z5sMkvpS--2L^,MP&w,VUweeL*)-*d3Y",
    "X-Hasura-Role": "user",
    "X-Hasura-User-Id": "9657c9f1-407a-4eef-babb-0323b0535c4f"
  },
  body: JSON.stringify({
    query: "query { org_members { role organization { id name } } }"
  })
})
  .then(res => res.json())
  .then(data => console.log(JSON.stringify(data, null, 2)))
  .catch(err => console.error("ERROR:", err));