import * as d3 from "d3";
import { complex, add, multiply, chain, sqrt } from "mathjs";
import { TopicModeler } from "topical";
import defaultStopwords from "./stopwords.js";


// GLOBALS
const width  = 800,
      height = 700,
      margin = {top: 30, bottom: 50, left: 50, right: 50},
      constants = {radii: [0, 15], rotationCoefficient: complex((1 / sqrt(2)), (1 / sqrt(2)))},
      svg = d3.select("svg").attr("width", width).attr("height", height);


let data, selectedColumns,
      documents, stopwords, modeler,
      topicLabels,
      topicTopWords = [],
      annotationGroup = svg.append("g").attr("class", "annotations");


function loadCsv(event) {
  let fileUpload = event.target;
  if ("files" in fileUpload) {
    for (var i = 0; i < fileUpload.files.length; i++) {
      var file = fileUpload.files.item(i);
      var reader = new FileReader();
      reader.addEventListener("loadend", event => parseAndShowCsvHeaders(event.srcElement.result));
      reader.readAsText(file);
    }
  }
}


function parseAndShowCsvHeaders(contents) {
  data = d3.csvParse(contents);

  d3.select("#data-preparation").style("display", "block");
  let columnLabels = d3.select("#select-columns ul")
      .selectAll("li")
      .data(data.columns)
    .enter()
      .append("li")
      .append("label");

  columnLabels.append("input").attr("type", "checkbox").attr("name", "columns[]").attr("value", d => d);
  columnLabels.append("span").text(d => d);
}


function processCorpus(event) {
  selectedColumns = Array.from(document.querySelectorAll("input[name='columns[]']:checked"))
                         .map(checkbox => checkbox.value);
  documents = data.map(csvRow => {
    let docId = csvRow["ID"];
    let docDate = csvRow["Pub Year"];
    return selectedColumns.reduce((docString, column) => docString += `${csvRow[column]} `, `${docId}\t${docDate}\t`);
  });
  initTopicModeler();
  clearTopics();
  clearQuadrants();
  displayCurrentTopics();
  event.preventDefault();
}


function initTopicModeler() {
  loadStopwords();
  modeler = new TopicModeler(stopwords, documents);
  modeler.numTopics = 4;
  modeler.processCorpus();
  modeler.requestedSweeps = 100;
  d3.select("#processing-details").style("display", "block");
  sweep();
}


function clearTopics() {
  // TODO: make these consistent by removing the empty list containers
  d3.selectAll("#top-terms-by-topic .topic").remove();
  d3.selectAll("#term-distribution ul li").remove();
  d3.selectAll("#corpus-topics ol li").remove();
  d3.select("svg g.container").remove();
  d3.selectAll(".article").remove();
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


  const xScale = d3.scaleLinear()
    .domain(d3.extent(modeler.documents, d => d.coordinates.re))
    .range([margin.left, width - margin.right])

  const yScale = d3.scaleLinear()
    .domain(d3.extent(modeler.documents, d => d.coordinates.im))
    .range([height - margin.bottom, margin.top])

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
  let articles = d3.select("#document-list")
      .selectAll(".article")
      .data(modeler.documents)
    .enter()
      .append("div")
      .attr("class", "article");

  articles.append("p").text(d => `${d.id} (${d.date})`);
  articles.append("p").text(d => d.originalText);
  displayArticleTopicDetails();
}


function toggleCustomStopword(event) {
  // Set the class for ALL instances if the feature term exists in multiple topics.
  document.querySelectorAll("#top-terms-by-topic li").forEach(feature => {
    if (feature.innerText == event.target.innerText)
      feature.classList.toggle("custom-stopword");
  });
}


function removeCustomStopword(event) {
  if (event.target.classList.contains("custom-stopword"))
    stopwords = stopwords.filter((value, index, arr) => value != event.target.innerText);
  else
    stopwords.push(event.target.innerText);

  event.target.classList.toggle("custom-stopword");
  event.target.classList.toggle("removed-custom-stopword");
}


function displayArticleTopicDetails() {
  let articles = d3.selectAll(".article");

  articles.append("p")
    .attr("class", "article-topic-scores")
    .text(d => {
      return topicTopWords.map((item, number) => `${topicLabels[number]}: ${d.topicCounts[number]}`).join("; ");
    });
  articles.append("p").attr("class", "article-topic-coords").text(d => d.coordinates);
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


function loadStopwords() {
  stopwords = stopwords == undefined ? defaultStopwords : stopwords;
  let customStopwords = Array.from(document.querySelectorAll(".custom-stopword"))
       .map(nodeItem => nodeItem.innerText)
       .filter(unique);
  stopwords = stopwords.concat(customStopwords).sort().filter(unique);

  d3.select("#stopwords").style("display", "block");
  d3.select("#stopwords ol").remove();
  d3.select("#stopwords")
      .append("ol")
      .selectAll(".stopword")
      .data(stopwords)
    .enter()
      .append("li")
      .attr("class", d => customStopwords.includes(d) ? "stopword custom-stopword" : "stopword")
      .text(d => d)
      .on("click", removeCustomStopword);
}


function unique(value, index, self) {
  return self.indexOf(value) === index;
}


// Handler when the DOM is fully loaded
const ready = () => {
  // EVENT WATCHERS
  document.getElementById("select-columns").addEventListener("submit", processCorpus);
  document.getElementById("reprocess").addEventListener("click", processCorpus);
  document.getElementById("corpus-upload").addEventListener("change", loadCsv);
  document.getElementById("resweep").addEventListener("click", resweep);
  document.querySelectorAll("#nav ul li a").forEach(navItem => navItem.addEventListener("click", toggleNavigation));
};

if (document.readyState === "complete" || (document.readyState !== "loading" && !document.documentElement.doScroll))
  ready();
else
  document.addEventListener("DOMContentLoaded", ready);
