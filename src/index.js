import * as d3 from "d3";
import { complex, add, multiply, chain, sqrt } from "mathjs";
import { TopicModeler } from "topical";
import defaultStopwords from "./stopwords.js";
import saveAs           from "./saveas.js";


// GLOBALS
const width  = 800,
      height = 700,
      margin = {top: 30, bottom: 50, left: 50, right: 50},
      constants = {radii: [0, 15], rotationCoefficient: complex((1 / sqrt(2)), (1 / sqrt(2)))},
      xScale = d3.scaleLinear().range([margin.left, width - margin.right]),
      yScale = d3.scaleLinear().range([height - margin.bottom, margin.top]),
      formatTimestamp = d3.timeFormat("%Y%m%dT%H%M%S%L"),
      formatCoord     = d3.format(".2f"),
      svg = d3.select("svg").attr("width", width).attr("height", height);


let data, columns, selectedColumns, idColumn, networkSource, networkDestination,
      documents,
      stopwords = defaultStopwords,
      customStopwords = [],
      removedDefaultStopwords = [],
      modeler,
      topicLabels,
      topicTopWords = [],
      network = {},
      synonyms = {},
      annotationGroup = svg.append("g").attr("class", "annotations");


function loadCsv(event) {
  let fileUpload = event.target;
  if ("files" in fileUpload) {
    const file = fileUpload.files.item(0);
    d3.select("#current-file span").text(file.name);
    const reader = new FileReader();
    reader.addEventListener("loadend", event => file.name.endsWith(".csv") ? parseAndShowCsvHeaders(event.srcElement.result) : loadSessionFile(event.srcElement.result));
    reader.readAsText(file);
  }
}


function loadSessionFile(session) {
  session = JSON.parse(session);

  data                    = session.data;
  columns                 = session.columns;
  selectedColumns         = session.selectedColumns;
  idColumn                = session.idColumn;
  networkSource           = session.networkSource;
  networkDestination      = session.networkDestination;
  network                 = session.network;
  documents               = session.documents;
  stopwords               = session.stopwords;
  customStopwords         = session.customStopwords;
  removedDefaultStopwords = session.removedDefaultStopwords;
  synonyms                = session.synonyms;
  modeler                 = TopicModeler.loadFromPriorModel(session.modeler);
  topicTopWords           = session.topicTopWords;
  topicLabels             = session.topicLabels;

  loadStopwords(true);
  displaySynonyms();
  displayColumns(session.columns, session.selectedColumns);
  updatePage();
}


function parseAndShowCsvHeaders(contents) {
  data = d3.csvParse(contents);
  columns = data.columns;
  loadStopwords(true);
  displayColumns(columns);
}


function displayColumns(columns, selectedColumns) {
  d3.select("#current-file").style("display", "block");
  d3.select("#download").style("display", "block");
  d3.select("#upload").style("display", "none");

  d3.select("#data-preparation").style("display", "block");

  let columnRows = d3.select("#select-columns table tbody")
        .selectAll("tr")
        .data(columns)
      .enter()
        .append("tr");

  columnRows.append("th").attr("class", "column").text(d => d);
  columnRows.append("td").append("input")
        .attr("type", "checkbox")
        .attr("name", "columns[]")
        .attr("value", d => d);
  columnRows.append("td").append("label").append("input")
        .attr("type", "radio")
        .attr("name", "identifier")
        .attr("value", d => d);
  columnRows.append("td").append("label").append("input")
        .attr("type", "radio")
        .attr("name", "network_source")
        .attr("value", d => d);
  columnRows.append("td").append("label").append("input")
        .attr("type", "radio")
        .attr("name", "network_destination")
        .attr("value", d => d);

  if (selectedColumns !== undefined) {
    columnRows.selectAll("input[name='columns[]']").property("checked", input => selectedColumns.includes(input));
    columnRows.selectAll("input[name='identifier'][value='" + idColumn + "']").property("checked", true);
    columnRows.selectAll("input[name='network_source'][value='" + networkSource + "']").property("checked", true);
    columnRows.selectAll("input[name='network_destination'][value='" + networkDestination + "']").property("checked", true);
  }
}


function reprocess(event) {
  loadStopwords(false);
  runModeling();
  event.preventDefault();
}


function selectColumns(event) {
  runModeling();
  event.preventDefault();
}


function runModeling() {
  selectedColumns    = Array.from(document.querySelectorAll("input[name='columns[]']:checked")).map(checkbox => checkbox.value);
  idColumn           = document.querySelector("input[name='identifier']:checked").value;
  networkSource      = document.querySelector("input[name='network_source']:checked").value;
  networkDestination = document.querySelector("input[name='network_destination']:checked").value;
  documents = data.map(csvRow => {
    let docId   = csvRow[idColumn];
    let docDate = csvRow["Pub Year"];
    return selectedColumns.reduce((docString, column) => docString += `${csvRow[column]} `, `${docId}\t${docDate}\t`);
  });

  if (networkSource != "none" && networkDestination != "none") {
    // Set up a convenience Hash for tracking network links between docs.
    network = data.reduce((result, doc) => ({...result, [doc[networkDestination]] : new Array()}), {});
    data.forEach(doc => {
      doc[networkSource].split("; ").forEach(source => {
        if (network.hasOwnProperty(source))
          network[source].push(doc[networkDestination]);
      });
    });
  }

  initTopicModeler();
  addDocumentReferences();
  updatePage();
}


function updatePage() {
  clearTopics();
  clearQuadrants();
  displayCurrentTopics();
}


function initTopicModeler() {
  modeler = new TopicModeler(stopwords, documents);
  modeler.synonyms = synonyms;
  modeler.numTopics = parseInt(document.getElementById("num-topics").value);
  modeler.processCorpus();
  modeler.requestedSweeps = 100;
  sweep();
}


function addDocumentReferences() {
  modeler.documents.forEach(doc => {
    doc.links = network[doc.id];
  });
}


function clearTopics() {
  // TODO: make these consistent by removing the empty list containers
  d3.selectAll("#top-terms-by-topic .topic").remove();
  d3.selectAll("#term-distribution ul li").remove();
  d3.selectAll("#corpus-topics ol li").remove();
  d3.select("svg g.container").remove();
  d3.selectAll(".document").remove();
  document.getElementById("show-networks").checked = false;
}


function clearQuadrants() {
  d3.selectAll(".axis").remove();
  d3.selectAll(".quadrant-axis").remove();
  d3.selectAll(".quadrant-label").remove();
}


function resweep() {
  clearTopics();
  modeler.requestedSweeps = modeler.completeSweeps + 50;
  sweep();
  clearQuadrants();
  displayCurrentTopics();
}


function sweep() {

  let start = new Date();
  while (modeler.completeSweeps < modeler.requestedSweeps) {
    modeler.sweep();
    document.getElementById("sweeps").innerHTML = modeler.completeSweeps;
  }
  let finish = new Date();
  document.getElementById("time").innerHTML = (finish - start) + "ms";

  // Pull out the top words from the topics
  for (let topic = 0; topic < modeler.numTopics; topic++)
    topicTopWords[topic] = modeler.topNWords(modeler.topicWordCounts[topic], 20);

  topicLabels = topicTopWords.map((item, number) => modeler.topNWords(modeler.topicWordCounts[number], 1));

  modeler.documents.forEach(doc => {
    const topic1 = multiply(constants.rotationCoefficient, complex(doc.topicCounts[0], 0));
    const topic2 = multiply(constants.rotationCoefficient, complex(0, doc.topicCounts[1]));
    const topic3 = multiply(constants.rotationCoefficient, complex(-doc.topicCounts[2], 0));
    const topic4 = multiply(constants.rotationCoefficient, complex(0, -doc.topicCounts[3]));

    doc.coordinates = chain(topic1)
                        .add(topic2)
                        .add(topic3)
                        .add(topic4)
                        .done();
  });
}


function displayCurrentTopics() {
  d3.select("#processing-details").style("display", "block");
  d3.select("#synonyms").style("display", "block");
  d3.select("#stopwords").style("display", "block");
  d3.select("#sweeps").text(modeler.completeSweeps);

  d3.select("#corpus-topics").style("display", "block");
  d3.select("#corpus-topics ol")
      .selectAll(".topic")
      .data(topicTopWords)
    .enter()
      .append("li")
      .attr("class", "topic")
      .text(d => d.split(" ").slice(0, 4).join(" "));

  // For the top topic words, how many topics do they appear in?
  let wordCounts = {};
  topicTopWords.forEach(wordList => {
    wordList.split(" ").forEach(word => {
      if (!wordCounts[word]) wordCounts[word] = {count: 0, word: word};
      wordCounts[word].count += 1
    });
  });

  d3.select("#top-terms").style("display", "block");
  d3.select("#term-distribution ul")
      .selectAll(".term")
      .data(Object.values(wordCounts).sort((a, b) => d3.descending(a.count, b.count)))
    .enter()
      .append("li")
      .attr("class", "term")
      .text(d => d.word + ": " + d.count + " topic" + (d.count > 1 ? "s" : ""))

  let topicTerms = d3.select("#top-terms-by-topic")
      .selectAll(".topic")
      .data(topicTopWords)
    .enter()
      .append("div")
      .attr("class", "topic");

  topicTerms.append("h3").text((d, i) => "Topic " + (i + 1));
  topicTerms.append("ol")
      .selectAll(".feature")
      .data(d => d.split(" "))
    .enter()
      .append("li")
      .attr("class", "feature")
      .text(d => d)
      .on("click", toggleCustomStopword);


  xScale.domain(d3.extent(modeler.documents, d => d.coordinates.re));
  yScale.domain(d3.extent(modeler.documents, d => d.coordinates.im));


  // TODO: pick a real data point for the color
  const colorScale = d3.scaleSequential(d3.interpolateBuPu)
    .domain(d3.extent(modeler.documents, d => d.coordinates.re));


  // TODO: pick a real data point for the color
  const sizeScale = d3.scaleSqrt()
    .domain(d3.extent(modeler.documents, d => d.coordinates.re))
    .range(constants.radii);

  const xAxis = d3.axisBottom(xScale);
  const yAxis = d3.axisLeft(yScale);

  const dotgroups = svg.append("g").attr("class", "container")
      .selectAll(".dot")
      .data(modeler.documents)
    .join("g")
      .attr("class", "dot")
      .attr("transform", d => `translate(${xScale(d.coordinates.re)}, ${yScale(d.coordinates.im)})`);

  dotgroups.append("circle")
    .attr("fill", "lightgrey")
    .attr("opacity", 0.6)
    // TODO
    .attr("r", "5");

  svg.append("g").attr("class", "axis x-axis")
    .attr("transform", `translate(0, ${height - margin.bottom})`)
    .call(xAxis)
    .append("text")
    .attr("class", "label")
    .text("X Axis")
    .attr("dy", "3em")
    .attr("x", "50%");

  svg.append("g").attr("class", "axis y-axis")
    .attr("transform", `translate(${margin.left}, 0)`)
    .call(yAxis)
    .append("text")
    .attr("class", "label")
    .text("Y Axis")
    .attr("y", "50%")
    .attr("dx", "-3em");

  // add quadrant lines and labels
  annotationGroup.append("path")
    .attr("class", "quadrant-axis")
    .attr("stroke","grey")
    .attr("transform",`translate(${xScale(0)},0)`)
    .attr("d", `M 0 ${margin.top} L 0 ${height - margin.bottom}`)

  annotationGroup.append("path")
    .attr("class", "quadrant-axis")
    .attr("stroke","grey")
    .attr("transform",`translate(0,${yScale(0)})`)
    .attr("d", `M ${margin.left} 0  L ${width - margin.right} 0`)

  annotationGroup.append("text")
    .attr("class", "quadrant-label")
    .attr("x", width - margin.right)
    .attr("y", margin.top * 2)
    .style("text-anchor", "end")
    .text("T1: " + topicLabels[0]);

  annotationGroup.append("text")
    .attr("class", "quadrant-label")
    .attr("x", margin.left * 1.5)
    .attr("y", margin.top * 2)
    .style("text-anchor", "start")
    .text("T2: " + topicLabels[1]);

  annotationGroup.append("text")
    .attr("class", "quadrant-label")
    .attr("x", margin.left * 1.5)
    .attr("y", height * .9)
    .style("text-anchor", "start")
    .text("T3: " + topicLabels[2]);

  annotationGroup.append("text")
    .attr("class", "quadrant-label")
    .attr("x", width - margin.right)
    .attr("y", height * .9)
    .style("text-anchor", "end")
    .text("T4: " + topicLabels[3]);

  d3.select("#document-list").style("display", "block");
  let documents = d3.select("#document-list")
      .selectAll(".document")
      .data(modeler.documents)
    .enter()
      .append("div")
      .attr("class", "document");

  documents.append("h3").text(d => `${d.id} (${d.date})`);
  documents.append("p").text(d => d.originalText.length > 128 ? d.originalText.slice(0, 128) + "..." : d.originalText);
  displayArticleTopicDetails();
}


function displayArticleTopicDetails() {
  let documents = d3.selectAll(".document");

  documents.append("p")
      .attr("class", "document-topic-scores")
      .text(d => {
        return topicTopWords.map((item, number) => `${topicLabels[number]}: ${d.topicCounts[number]}`).join("; ");
      });

  documents.append("p").attr("class", "document-topic-coords").text(d => {
    return "Real: " + formatCoord(d.coordinates.re) + ", Imaginary: " + formatCoord(d.coordinates.im);
  });
}


function toggleNavigation(event) {
  toggleMainDisplay(event.target.innerText);
  event.preventDefault();
}


function toggleMainDisplay(displaySection) {
  document.querySelectorAll("#main #nav ul li a").forEach(navItem => {
    if (navItem.innerText == displaySection)
      navItem.classList.add("selected");
    else
      navItem.classList.remove("selected");
  });

  if (displaySection == "Manage") {
    d3.select("#manage").style("display", "block");
    d3.select("#graph").style("display", "none");
  } else {
    d3.select("#graph").style("display", "block");
    d3.select("#manage").style("display", "none");
  }
}


function loadStopwords(firstLoad) {
  if (!firstLoad) {
    customStopwords = Array.from(document.querySelectorAll(".custom-stopword"))
         .map(nodeItem => nodeItem.innerText)
         .filter(unique);
    removedDefaultStopwords = Array.from(document.querySelectorAll(".removed-default-stopword"))
         .map(nodeItem => nodeItem.innerText)
         .filter(unique);
    stopwords = defaultStopwords.filter(word => !removedDefaultStopwords.includes(word))
         .concat(customStopwords)
         .sort()
         .filter(unique);
  }

  d3.select("#add-stopwords ol").remove();
  d3.select("#add-stopwords")
      .append("ol")
      .selectAll(".stopword")
      .data(customStopwords.concat(defaultStopwords).sort())
    .enter()
      .append("li")
      .attr("class", d => {
        let cls = ["stopword"];
        if (customStopwords.includes(d)) cls.push("custom-stopword");
        if (removedDefaultStopwords.includes(d)) cls.push("removed-default-stopword");
        return cls.join(" ");
      })
      .text(d => d)
      .on("click", toggleStopword);
}


function toggleCustomStopword(event) {
  // Set the class for ALL instances if the feature term exists in multiple topics.
  document.querySelectorAll("#top-terms-by-topic li").forEach(feature => {
    if (feature.innerText == event.target.innerText)
      feature.classList.toggle("custom-stopword");
  });
}


function toggleStopword(event) {
  if (event.target.classList.contains("custom-stopword")) {
    // stopwords = stopwords.filter((value, index, arr) => value != event.target.innerText);
    event.target.classList.remove("custom-stopword");
    event.target.classList.toggle("removed-custom-stopword");
  } else if (event.target.classList.contains("removed-default-stopword")) {
    event.target.classList.remove("removed-default-stopword");
  } else {
    event.target.classList.add("removed-default-stopword");
  }
}


function toggleNetworks(event) {
  if (event.target.checked) {

    let container = d3.select("svg g.container");
    modeler.documents.forEach(doc => {
      let sourceDoc = getDocumentById(doc.id);
      doc.links.map(link => getDocumentById(link))
          .filter(linkedDoc => linkedDoc !== undefined)
          .forEach(linkedDoc => {
            container.append("line")
              .style("stroke", "steelblue")
              .style("stroke-width", "1")
              .style("opacity", 0.33)
              .attr("class", "citing-line")
              .attr("x1", xScale(sourceDoc.coordinates.re))
              .attr("y1", yScale(sourceDoc.coordinates.im))
              .attr("x2", xScale(linkedDoc.coordinates.re))
              .attr("y2", yScale(linkedDoc.coordinates.im));
          });
    });
  } else {
    d3.selectAll(".citing-line").remove();
  }
}


function getDocumentById(id) {
  return modeler.documents.filter(doc => doc.id == id)[0];
}


function unique(value, index, self) {
  return self.indexOf(value) === index;
}


function addManualStopwords() {
  document.getElementById("manual-stopwords").value.split(/\s+/).forEach(word => {
    d3.select("#stopwords ol").append("li").attr("class", "stopword custom-stopword").text(word);
  });
  loadStopwords(false);
  document.getElementById("manual-stopwords").value = "";
  event.preventDefault();
}


function addManualSynonyms() {
  let newSynonyms = document.getElementById("manual-synonyms").value.split(/\s+/);
  let mainWord = newSynonyms.shift();
  newSynonyms.forEach(word => synonyms[word] = mainWord);
  displaySynonyms();
  document.getElementById("manual-synonyms").value = "";
  event.preventDefault();
}


function displaySynonyms() {
  d3.selectAll(".mapped-synonym").remove();
  d3.select("#add-synonyms")
      .selectAll(".mapped-synonym")
      .data(Object.keys(synonyms).sort())
    .enter()
      .append("p")
      .attr("class", "mapped-synonym")
      .text(d => `${d}: ${synonyms[d]}`);
}


function download() {

  saveAs(
    new Blob([JSON.stringify({
      data: data,
      columns: columns,
      selectedColumns: selectedColumns,
      idColumn: idColumn,
      networkSource: networkSource,
      networkDestination: networkDestination,
      network: network,
      documents: documents,
      stopwords: stopwords,
      customStopwords: customStopwords,
      removedDefaultStopwords: removedDefaultStopwords,
      synonyms: synonyms,
      modeler: modeler,
      topicTopWords: topicTopWords,
      topicLabels: topicLabels
    })], {type: "application/json;charset=utf-8"}),
    "quadropical-session-" + formatTimestamp(new Date()) + ".json"
  );

  event.preventDefault();
}


function toggleAccordion() {
  this.classList.toggle("active");
  var panel = this.nextElementSibling;
  if (panel.style.maxHeight)
    panel.style.maxHeight = null;
  else
    panel.style.maxHeight = panel.scrollHeight + "px";
}


// Handler when the DOM is fully loaded
const ready = () => {
  // EVENT WATCHERS
  document.getElementById("select-columns").addEventListener("submit", selectColumns);
  document.getElementById("reprocess").addEventListener("click", reprocess);
  document.getElementById("corpus-upload").addEventListener("change", loadCsv);
  document.getElementById("resweep").addEventListener("click", resweep);
  document.querySelector("#add-stopwords form").addEventListener("submit", addManualStopwords);
  document.querySelector("#add-synonyms form").addEventListener("submit", addManualSynonyms);
  document.querySelectorAll("#nav ul li a").forEach(navItem => navItem.addEventListener("click", toggleNavigation));
  document.getElementById("show-networks").addEventListener("change", toggleNetworks);
  document.getElementById("download-button").addEventListener("click", download);
  document.querySelectorAll(".accordion").forEach(sectionName => sectionName.addEventListener("click", toggleAccordion));
};

if (document.readyState === "complete" || (document.readyState !== "loading" && !document.documentElement.doScroll))
  ready();
else
  document.addEventListener("DOMContentLoaded", ready);
