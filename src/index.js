import * as d3 from "d3";
import { TopicModeler } from "topical";
import "./style.css";


function process(event) {
  let fileUpload = event.target;

  if ('files' in fileUpload) {
    Promise.all([
      readFileLines(fileUpload, "stopwords.txt"),
      readFileLines(fileUpload, "documents.txt")
    ]).then(([stopwords, documents]) => {

      let start = new Date();

      let modeler = new TopicModeler(stopwords, documents);
      modeler.numTopics = 4;
      modeler.processCorpus();
      modeler.requestedSweeps = 100;
      d3.select("#processing-details").style("opacity", 1);
      while (modeler.completeSweeps < modeler.requestedSweeps) {
          modeler.sweep();
          document.getElementById("sweeps").innerHTML = modeler.completeSweeps;
      }

      // Pull out the top words from the topics
      let topicTopWords = [];
      for (let topic = 0; topic < modeler.numTopics; topic++)
          topicTopWords.push(modeler.topNWords(modeler.topicWordCounts[topic], modeler.numTopics));

      d3.select("#corpus-topics").style("opacity", 1);
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

      d3.select("#term-distribution").style("opacity", 1);
      d3.select("#term-distribution ul")
          .selectAll(".term")
          .data(Object.values(wordCounts).sort((a, b) => d3.descending(a.count, b.count)))
        .enter()
          .append("li")
          .attr("class", "term")
          .text(d => d.word + ": " + d.count + " topic" + (d.count > 1 ? "s" : ""))

      let finish = new Date();
      document.getElementById("time").innerHTML = (finish - start) + "ms";
    });
  }
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
const ready = () => document.getElementById("file-upload").addEventListener("change", process);
if (document.readyState === "complete" || (document.readyState !== "loading" && !document.documentElement.doScroll))
  ready();
else
  document.addEventListener("DOMContentLoaded", ready);
