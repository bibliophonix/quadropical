import * as d3 from "d3";
import { complex, add, multiply, chain, sqrt } from "mathjs";
import { TopicModeler } from "topical";
import defaultStopwords from "./stopwords.js";
import "./style.css";


// GLOBALS
const width  = 700,
      height = 700,
      margin = {top: 30, bottom: 50, left: 50, right: 50},
      constants = {radii: [0, 15], rotationCoefficient: complex((1 / sqrt(2)), (1 / sqrt(2)))},
      svg = d3.select("svg").attr("width", width).attr("height", height);


let data, selectedColumns, documents, stopwords;


function loadCsv(event) {
  let fileUpload = event.target;
  if ("files" in fileUpload) {
    for (var i = 0; i < fileUpload.files.length; i++) {
      var file = fileUpload.files.item(i);
      renderFileMetadata(file);
      var reader = new FileReader();
      reader.addEventListener("loadend", event => parseAndShowCsvHeaders(event.srcElement.result));
      reader.readAsText(file);
    }
  }
}


function renderFileMetadata(file) {
  d3.select("#file-details").append("p").text(file.name + " " + file.size + " bytes");
  d3.select("#file-details").style("display", "block");
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


function selectColumns(event) {
  selectedColumns = Array.from(document.querySelectorAll("input[name='columns[]']:checked"))
                         .map(checkbox => checkbox.value);
  documents = data.map(csvRow => selectedColumns.reduce((docString, column) => docString += `${csvRow[column]} `, ""));
  process();
  event.preventDefault();
}


function process() {
  let start = new Date();

  stopwords = stopwords == undefined ? defaultStopwords : stopwords;
  let modeler = new TopicModeler(stopwords, documents);
  modeler.numTopics = 4;
  modeler.processCorpus();
  modeler.requestedSweeps = 100;
  d3.select("#processing-details").style("display", "block");
  while (modeler.completeSweeps < modeler.requestedSweeps) {
      modeler.sweep();
      document.getElementById("sweeps").innerHTML = modeler.completeSweeps;
  }

  // Pull out the top words from the topics
  let topicTopWords = [];
  for (let topic = 0; topic < modeler.numTopics; topic++)
      topicTopWords.push(modeler.topNWords(modeler.topicWordCounts[topic], modeler.numTopics));

  d3.select("#corpus-topics").style("display", "block");
  d3.select("#corpus-topics ol")
      .selectAll(".topic")
      .data(topicTopWords)
    .enter()
      .append("li")
      .attr("class", "topic")
      .text(d => d);

  // For the top topic words, how many topics do they appear in?
  let wordCounts = {};
  topicTopWords.forEach(wordList => {
    wordList.split(" ").forEach(word => {
      if (!wordCounts[word]) wordCounts[word] = {count: 0, word: word};
      wordCounts[word].count += 1
    });
  });

  // d3.select("#term-distribution").style("opacity", 1);
  // d3.select("#term-distribution ul")
  //     .selectAll(".term")
  //     .data(Object.values(wordCounts).sort((a, b) => d3.descending(a.count, b.count)))
  //   .enter()
  //     .append("li")
  //     .attr("class", "term")
  //     .text(d => d.word + ": " + d.count + " topic" + (d.count > 1 ? "s" : ""))

  let finish = new Date();
  document.getElementById("time").innerHTML = (finish - start) + "ms";


  let topicLabels = topicTopWords.map((item, number) => modeler.topNWords(modeler.topicWordCounts[number], 1));

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


  const xScale = d3.scaleLinear()
    .domain(d3.extent(modeler.documents, d => d.coordinates.re))
    .range([margin.left, width - margin.right])


  const yScale = d3.scaleLinear()
    .domain(d3.extent(modeler.documents, d => d.coordinates.im))
    .range([height - margin.bottom, margin.top])


  // TODO: pick a real data point for the color
  const colorScale = d3.scaleSequential(d3.interpolateBuPu)
    .domain(d3.extent(modeler.documents, d => d.coordinates.re))


  // TODO: pick a real data point for the color
  const sizeScale = d3.scaleSqrt()
    .domain(d3.extent(modeler.documents, d => d.coordinates.re))
    .range(constants.radii)


  const xAxis = d3.axisBottom(xScale);
  const yAxis = d3.axisLeft(yScale);


  const dotsContainer = svg.append("g").attr("class","container")

  const dotgroups = dotsContainer.selectAll(".dot")
    .data(modeler.documents)
    .join("g")
    .attr("class", "dot")
    .attr("transform", d => `translate(${xScale(d.coordinates.re)}, ${yScale(d.coordinates.im)})`);

  dotgroups.append("circle")
    .attr("fill", "lightgrey")
    .attr("opacity", 0.6)
    // TODO
    .attr("r", "5");

  svg.append("g")
    .attr("class", "axis x-axis")
    .attr("transform", `translate(0, ${height - margin.bottom})`)
    .call(xAxis)
    .append("text")
    .attr("class", "label")
    .text("X Axis")
    .attr("dy", "3em")
    .attr("x", "50%");

  svg.append("g")
    .attr("class", "axis y-axis")
    .attr("transform", `translate(${margin.left}, 0)`)
    .call(yAxis)
    .append("text")
    .attr("class", "label")
    .text("Y Axis")
    .attr("y", "50%")
    .attr("dx", "-3em");

  // add quadrant lines
  const annotationGroup = svg.append("g").attr("class", "annotations")

  annotationGroup.append("path")
    .attr("stroke","grey")
    .attr("transform",`translate(${xScale(0)},0)`)
    .attr("d", `M 0 ${margin.top} L 0 ${height - margin.bottom}`)

  annotationGroup.append("path")
    .attr("stroke","grey")
    .attr("transform",`translate(0,${yScale(0)})`)
    .attr("d", `M ${margin.left} 0  L ${width - margin.right} 0`)

  annotationGroup.append("text")
    .attr("x", width - margin.right)
    .attr("y", margin.top * 2)
    .style("text-anchor", "end")
    .text("Q1: " + topicLabels[0]);

  annotationGroup.append("text")
    .attr("x", margin.left * 1.5)
    .attr("y", margin.top * 2)
    .style("text-anchor", "start")
    .text("Q2: " + topicLabels[1]);

  annotationGroup.append("text")
    .attr("x", margin.left * 1.5)
    .attr("y", height * .9)
    .style("text-anchor", "start")
    .text("Q3: " + topicLabels[2]);

  annotationGroup.append("text")
    .attr("x", width - margin.right)
    .attr("y", height * .9)
    .style("text-anchor", "end")
    .text("Q4: " + topicLabels[3]);

  let articles = d3.select("#graph")
      .selectAll(".article")
      .data(modeler.documents)
    .enter()
      .append("div")
      .attr("class", "article");

  articles.append("p").text(d => d.originalText);
  articles.append("p").text(d => {
    return topicTopWords.map((item, number) => `${topicLabels[number]}: ${d.topicCounts[number]}`).join("; ");
  });
  articles.append("p").text(d => d.coordinates);
}


async function readFileLines(fileUpload, filenameToMatch) {
  let file,
      lines  = new Array(),
      reader = new FileReader();

  if (fileUpload.files.item(0).name == filenameToMatch) file = fileUpload.files.item(0);
  if (fileUpload.files.item(1).name == filenameToMatch) file = fileUpload.files.item(1);
  if (file == undefined) throw "No file uploaded matching " + filenameToMatch;

  await readUploadedFileAsText(file)
        .then(contents => contents.split("\n").forEach(line => lines.push(line)))
        .catch(error => console.error(error));

  return lines;
}


const readUploadedFileAsText = (inputFile) => {
  const reader = new FileReader();

  return new Promise((resolve, reject) => {
    reader.onerror = () => {
      reader.abort();
      reject(new DOMException("Problem parsing input file."));
    };
    reader.onload = () => resolve(reader.result);
    reader.readAsText(inputFile);
  });
}


// Handler when the DOM is fully loaded
const ready = () => {
  // EVENT WATCHERS
  document.getElementById("select-columns").addEventListener("submit", selectColumns);
  document.getElementById("corpus-upload").addEventListener("change", loadCsv);
};

if (document.readyState === "complete" || (document.readyState !== "loading" && !document.documentElement.doScroll))
  ready();
else
  document.addEventListener("DOMContentLoaded", ready);
